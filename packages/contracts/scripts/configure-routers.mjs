import { config as loadEnv } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

loadEnv({ path: resolve(import.meta.dirname, "../../../.env"), override: false });

const networks = {
  xlayer: {
    id: 196,
    primary: process.env.X_LAYER_RPC,
    fallback: process.env.X_LAYER_RPC_FALLBACK,
    router: process.env.XLAYER_OKX_ROUTER_ADDRESS,
  },
  base: {
    id: 8453,
    primary: process.env.BASE_RPC_URL,
    fallback: process.env.BASE_RPC_FALLBACK_URL,
    router: process.env.BASE_OKX_ROUTER_ADDRESS,
  },
  arbitrum: {
    id: 42161,
    primary: process.env.ARBITRUM_RPC_URL,
    fallback: process.env.ARBITRUM_RPC_FALLBACK_URL,
    router: process.env.ARBITRUM_OKX_ROUTER_ADDRESS,
  },
};

const privateKey = process.env.CONTRACT_DEPLOYER_PRIVATE_KEY || process.env.TEST_WALLET_PRIVATE_KEY;
if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey || "")) throw new Error("Deployer key missing");
const signer = privateKeyToAccount(privateKey);
const root = resolve(import.meta.dirname, "..");
const adapterArtifact = JSON.parse(await readFile(resolve(root, "artifacts/OkxSwapAdapterV1.json"), "utf8"));

for (const [name, network] of Object.entries(networks)) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(network.router || "")) throw new Error(`${name} router missing`);
  const urls = [...new Set([network.primary, network.fallback].filter(Boolean))];
  if (!urls.length) throw new Error(`${name} RPC missing`);
  const transport = fallback(urls.map((url) => http(url, { retryCount: 2, retryDelay: 700 })), { retryCount: 1 });
  const chain = {
    id: network.id,
    name,
    nativeCurrency: { name: "Native", symbol: name === "xlayer" ? "OKB" : "ETH", decimals: 18 },
    rpcUrls: { default: { http: urls } },
  };
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account: signer, chain, transport });
  const manifestPath = resolve(root, "deployments", `${network.id}.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const adapter = manifest.contracts.executionAdapter.address;
  const alreadyApproved = await publicClient.readContract({
    address: adapter,
    abi: adapterArtifact.abi,
    functionName: "approvedRouters",
    args: [network.router],
  });
  let transaction = null;
  if (!alreadyApproved) {
    transaction = await walletClient.writeContract({
      account: signer,
      address: adapter,
      abi: adapterArtifact.abi,
      functionName: "setRouter",
      args: [network.router, true],
    });
    console.log(`${name}: submitted router approval tx=${transaction}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transaction, confirmations: 1, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${name} router approval failed`);
  }
  let verified = false;
  for (let attempt = 0; attempt < 10 && !verified; attempt += 1) {
    if (attempt) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500));
    verified = await publicClient.readContract({
      address: adapter,
      abi: adapterArtifact.abi,
      functionName: "approvedRouters",
      args: [network.router],
    });
  }
  if (!verified) throw new Error(`${name} router approval could not be verified`);
  manifest.routerUpgrade = {
    configuredAt: new Date().toISOString(),
    router: network.router,
    adapter,
    transaction,
    verifiedOnchain: true,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`${name}: ${network.router} approved=${verified}${transaction ? ` tx=${transaction}` : " (already configured)"}`);
}

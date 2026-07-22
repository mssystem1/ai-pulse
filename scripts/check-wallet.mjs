/**
 * Check native OKB + USD₮0 balance for the test wallet on X Layer.
 * Usage: node scripts/check-wallet.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    const v = m[2].trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

const RPC = process.env.X_LAYER_RPC || "https://rpc.xlayer.tech";
const ADDR = (process.env.TEST_WALLET_ADDRESS || process.env.PAY_TO_ADDRESS || "").toLowerCase();
const USDT0 = (process.env.X402_ASSET || "0x779ded0c9e1022225f8e0630b35a9b54be713736").toLowerCase();

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

function hexToBigInt(h) {
  return BigInt(h || "0x0");
}

function formatUnits(v, decimals) {
  const s = v.toString().padStart(decimals + 1, "0");
  const i = s.slice(0, -decimals) || "0";
  const f = s.slice(-decimals).replace(/0+$/, "") || "0";
  return `${i}.${f}`;
}

// balanceOf(address) selector
const BALANCE_OF = "0x70a08231" + ADDR.replace(/^0x/, "").padStart(64, "0");

const [okbHex, usdtHex, chainIdHex, nonceHex] = await Promise.all([
  rpc("eth_getBalance", [ADDR, "latest"]),
  rpc("eth_call", [{ to: USDT0, data: BALANCE_OF }, "latest"]),
  rpc("eth_chainId", []),
  rpc("eth_getTransactionCount", [ADDR, "latest"]),
]);

const okb = hexToBigInt(okbHex);
const usdt = hexToBigInt(usdtHex);

console.log(JSON.stringify({
  rpc: RPC,
  chainId: Number(chainIdHex),
  address: ADDR,
  nonce: Number(nonceHex),
  okb: formatUnits(okb, 18),
  usdt0: formatUnits(usdt, 6),
  okbWei: okb.toString(),
  usdt0Atomic: usdt.toString(),
}, null, 2));

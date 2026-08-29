/** X Layer public balances — OKB (native) + USDT0 (ERC-20) */

export const USDT0_ADDRESS = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const X_LAYER_RPC = "https://rpc.xlayer.tech";

export type WalletBalances = {
  address: string;
  okb: number;
  usdt0: number;
  okbRaw: string;
  usdt0Raw: string;
  fetchedAt: string;
};

async function rpc(method: string, params: unknown[]): Promise<string> {
  const res = await fetch(X_LAYER_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await res.json()) as { result?: string; error?: { message: string } };
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result || "0x0";
}

function hexToBigInt(hex: string): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function formatUnits(value: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 6);
  return Number(`${whole}.${fracStr}`);
}

/** balanceOf(address) */
function balanceOfData(holder: string): string {
  const addr = holder.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
  return `0x70a08231${addr}`;
}

export async function fetchWalletBalances(address: string): Promise<WalletBalances> {
  const [okbHex, usdtHex] = await Promise.all([
    rpc("eth_getBalance", [address, "latest"]),
    rpc("eth_call", [{ to: USDT0_ADDRESS, data: balanceOfData(address) }, "latest"]),
  ]);
  const okbRaw = hexToBigInt(okbHex);
  const usdtRaw = hexToBigInt(usdtHex);
  return {
    address,
    okb: formatUnits(okbRaw, 18),
    usdt0: formatUnits(usdtRaw, 6),
    okbRaw: okbRaw.toString(),
    usdt0Raw: usdtRaw.toString(),
    fetchedAt: new Date().toISOString(),
  };
}

/** Service → required USDT0 (human) */
export const PRICE_USDT0: Record<string, number> = {
  base: 0.20,
  premium: 0.30,
  token: 0.20,
  preflight: 0.15,
};

export function assertUsdt0Enough(
  usdt0Balance: number,
  required: number,
  lang: "en" | "zh" = "en",
): void {
  // small epsilon for float
  if (usdt0Balance + 1e-9 >= required) return;
  const need = required.toFixed(2);
  const have = usdt0Balance.toFixed(6);
  if (lang === "zh") {
    throw new Error(
      `USDT0 余额不足。需要 ${need} USDT0，当前约 ${have}。请在钱包面板中将 OKB 换成 USDT0（X Layer）。`,
    );
  }
  throw new Error(
    `Insufficient USDT0. Need ${need} USDT0, wallet has ~${have}. Open Wallet & funding to swap OKB → USDT0 on X Layer before paying.`,
  );
}

export function fmtBal(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

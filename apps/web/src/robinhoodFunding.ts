export type RobinhoodFundingQuote = {
  network: "robinhood"; chainId: 4663; fromAmount: string; toAmount: string; minToAmount: string;
  toToken: string; priceImpactPercent: string; route: string[]; expiresAt: number;
  transaction: { from: string; to: string; data: string; value: string };
};
export type FundingProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const ROUTER = "0x6e2a35a7ad683cf634d91492d73bb7ff774c6919";
const quantity = (n: bigint) => `0x${n.toString(16)}`;

export function validateFundingQuote(quote: RobinhoodFundingQuote, owner: string, amount: bigint, now = Date.now()) {
  if (quote.network !== "robinhood" || quote.chainId !== 4663 || quote.toToken?.toLowerCase() !== USDG
    || !/^0x[\da-f]{40}$/i.test(owner) || amount <= 0n || BigInt(quote.fromAmount) !== amount
    || BigInt(quote.toAmount) <= 0n || BigInt(quote.minToAmount) <= 0n
    || BigInt(quote.minToAmount) < BigInt(quote.toAmount) * 995n / 1000n
    || BigInt(quote.minToAmount) > BigInt(quote.toAmount)
    || !Number.isFinite(Number(quote.priceImpactPercent)) || Math.abs(Number(quote.priceImpactPercent)) > 1
    || quote.transaction.from.toLowerCase() !== owner.toLowerCase()
    || quote.transaction.to.toLowerCase() !== ROUTER || BigInt(quote.transaction.value) !== amount
    || !/^0x(?:f2c42696|0c307f76)(?:[\da-f]{2})+$/i.test(quote.transaction.data)) throw new Error("The funding quote does not match this wallet, network or amount.");
  if (!Number.isFinite(quote.expiresAt) || quote.expiresAt <= now || quote.expiresAt > now + 60_000) throw new Error("Quote expired. Get a fresh ETH to USDG quote.");
}

/** Called only after the user chooses Review & swap. No automatic ETH conversion. */
export async function submitRobinhoodFunding(provider: FundingProvider, quote: RobinhoodFundingQuote, owner: string, amount: bigint) {
  validateFundingQuote(quote, owner, amount);
  const assertWallet = async () => {
    const [chain, accounts] = await Promise.all([provider.request({ method: "eth_chainId" }), provider.request({ method: "eth_accounts" })]);
    if (Number(chain) !== 4663 || !Array.isArray(accounts) || String(accounts[0]).toLowerCase() !== owner.toLowerCase()) {
      throw new Error("Select the quoted wallet on Robinhood Chain, then request a fresh quote.");
    }
  };
  await assertWallet();
  const tx = { from: owner, to: quote.transaction.to, data: quote.transaction.data, value: quantity(amount) };
  // Both simulations must succeed; a failed call never proceeds to signing.
  await provider.request({ method: "eth_call", params: [tx, "latest"] });
  const [estimated, price, balance] = await Promise.all([
    provider.request({ method: "eth_estimateGas", params: [tx] }),
    provider.request({ method: "eth_gasPrice" }),
    provider.request({ method: "eth_getBalance", params: [owner, "latest"] }),
  ]);
  const gas = BigInt(String(estimated)) * 125n / 100n;
  const gasPrice = BigInt(String(price)) * 2n;
  if (gas <= 0n || gas > 1_000_000n || gasPrice <= 0n) throw new Error("Unable to verify funding gas. No transaction was submitted.");
  if (BigInt(String(balance)) < amount + gas * gasPrice + 20_000_000_000_000n) {
    throw new Error("Reduce the ETH amount: keep enough for this swap's gas and a 0.00002 ETH reserve.");
  }
  await assertWallet();
  validateFundingQuote(quote, owner, amount);
  const hash = await provider.request({ method: "eth_sendTransaction", params: [{ ...tx, chainId: "0x1237", gas: quantity(gas), gasPrice: quantity(gasPrice) }] });
  if (typeof hash !== "string" || !/^0x[\da-f]{64}$/i.test(hash)) throw new Error("Wallet did not return a transaction hash. Check wallet activity before retrying.");
  return hash;
}

export type IndicatorOffer = { kind: "version-service"; priceUsdc: string; description: string };
export type IndicatorPaymentNetwork = "xlayer" | "base" | "arbitrum";
export type IndicatorRegistration = { version: string; chainId: 196; factory: string; processor: string; circuitId: string; blockNumber: string; blockHash: string; codeHash: string; netlistHash: string; observedAt: number; vectorCount: number; verified: true; transactionHash?: string };
export type IndicatorPurchase = {
  id: string; requestId: string; owner: string; listingId: string; publisher: string;
  title: string; version: string; sha256: string; packageRef: string;
  offer: IndicatorOffer; priceUsdc: string; amountAtomic: string; network: IndicatorPaymentNetwork;
  asset: string; payee: string; createdAt: string; expiresAt: string;
  state: "quoted" | "authorizing" | "granted"; nonce?: string; preparedBlock?: string;
  paymentId?: string; settlementTx?: string; grantedAt?: string; simulated: boolean;
};
export type IndicatorSale = { id: string; listingId: string; publisher: string; buyer: string; title: string; version: string; sha256: string; amountAtomic: string; priceUsdc: string; asset: string; network: IndicatorPaymentNetwork; settlementTx?: string; at: string; simulated: boolean };

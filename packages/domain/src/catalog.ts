/** Known X Layer / ecosystem tokens for free resolve + demo realism */
export type CatalogToken = {
  address: string;
  symbol: string;
  name: string;
  chainId: string;
  kind: "token" | "native" | "stable" | "unknown";
  decimals: number;
};

export const NATIVE_OKB: CatalogToken = {
  address: "0x0000000000000000000000000000000000000000",
  symbol: "OKB",
  name: "OKB (Native)",
  chainId: "196",
  kind: "native",
  decimals: 18,
};

export const USDT0: CatalogToken = {
  address: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
  symbol: "USD₮0",
  name: "Tether USD0",
  chainId: "196",
  kind: "stable",
  decimals: 6,
};

export const WOKB: CatalogToken = {
  address: "0xe538905cf8410324e03a5a23c1c177a474d59b2b",
  symbol: "WOKB",
  name: "Wrapped OKB",
  chainId: "196",
  kind: "token",
  decimals: 18,
};

export const CATALOG: CatalogToken[] = [
  NATIVE_OKB,
  USDT0,
  WOKB,
  {
    address: "0x74b7f16337b8972027f6196a17a631ac6de26d22",
    symbol: "USDC",
    name: "USD Coin",
    chainId: "196",
    kind: "stable",
    decimals: 6,
  },
  {
    address: "0x1e4a5963abfd975d8c9021ce480b42188849d41d",
    symbol: "USDT",
    name: "Tether USD",
    chainId: "196",
    kind: "stable",
    decimals: 6,
  },
];

export function findByAddress(address: string): CatalogToken | undefined {
  const a = address.toLowerCase();
  return CATALOG.find((t) => t.address.toLowerCase() === a);
}

export function resolveQuery(query: string, chainId = "196"): CatalogToken[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  if (/^0x[a-f0-9]{40}$/.test(q)) {
    const hit = findByAddress(q);
    if (hit) return [hit];
    return [
      {
        address: q,
        symbol: "UNK",
        name: "Unknown Token",
        chainId,
        kind: "unknown",
        decimals: 18,
      },
    ];
  }

  return CATALOG.filter(
    (t) =>
      t.chainId === chainId &&
      (t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.symbol.replace(/[^\w]/g, "").toLowerCase() === q),
  );
}

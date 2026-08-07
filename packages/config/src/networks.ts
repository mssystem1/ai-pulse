export const NETWORK_KEYS = ["xlayer", "base", "arbitrum", "arc-testnet"] as const;

export type NetworkKey = (typeof NETWORK_KEYS)[number];
export type PaymentProvider = "okx" | "cdp" | "circle-gateway";

export type AssetConfig = Readonly<{
  symbol: string;
  name: string;
  decimals: number;
  address: `0x${string}` | null;
}>;

export type PulseNetwork = Readonly<{
  key: NetworkKey;
  label: string;
  chainId: number;
  caip2: `eip155:${number}`;
  environment: "mainnet" | "testnet";
  rpcUrls: readonly string[];
  explorerUrl: string;
  nativeAsset: AssetConfig;
  paymentAsset: AssetConfig;
  paymentProvider: PaymentProvider;
  tokenDiscoveryProvider: "okx" | "generic-evm" | null;
  contractEvidenceProvider: "xlayer-rpc" | "generic-evm" | null;
  fundingOptions: readonly string[];
}>;

const asset = (value: AssetConfig): AssetConfig => Object.freeze(value);
const network = (value: PulseNetwork): PulseNetwork =>
  Object.freeze({
    ...value,
    rpcUrls: Object.freeze([...value.rpcUrls]),
    fundingOptions: Object.freeze([...value.fundingOptions]),
  });

export const NETWORK_REGISTRY: Readonly<Record<NetworkKey, PulseNetwork>> = Object.freeze({
  xlayer: network({
    key: "xlayer",
    label: "X Layer",
    chainId: 196,
    caip2: "eip155:196",
    environment: "mainnet",
    rpcUrls: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
    explorerUrl: "https://www.okx.com/web3/explorer/xlayer",
    nativeAsset: asset({ symbol: "OKB", name: "OKB", decimals: 18, address: null }),
    paymentAsset: asset({
      symbol: "USD₮0",
      name: "Tether USD₮0",
      decimals: 6,
      address: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    }),
    paymentProvider: "okx",
    tokenDiscoveryProvider: "okx",
    contractEvidenceProvider: "xlayer-rpc",
    fundingOptions: ["okx-dex-okb-usdt0"],
  }),
  base: network({
    key: "base",
    label: "Base",
    chainId: 8453,
    caip2: "eip155:8453",
    environment: "mainnet",
    rpcUrls: ["https://mainnet.base.org"],
    explorerUrl: "https://basescan.org",
    nativeAsset: asset({ symbol: "ETH", name: "Ether", decimals: 18, address: null }),
    paymentAsset: asset({
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    }),
    paymentProvider: "cdp",
    tokenDiscoveryProvider: "generic-evm",
    contractEvidenceProvider: "generic-evm",
    fundingOptions: ["fund-usdc", "swap-to-usdc"],
  }),
  arbitrum: network({
    key: "arbitrum",
    label: "Arbitrum One",
    chainId: 42161,
    caip2: "eip155:42161",
    environment: "mainnet",
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    explorerUrl: "https://arbiscan.io",
    nativeAsset: asset({ symbol: "ETH", name: "Ether", decimals: 18, address: null }),
    paymentAsset: asset({
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    }),
    paymentProvider: "cdp",
    tokenDiscoveryProvider: "generic-evm",
    contractEvidenceProvider: "generic-evm",
    fundingOptions: ["bridge-native-usdc", "fund-usdc", "swap-to-usdc"],
  }),
  "arc-testnet": network({
    key: "arc-testnet",
    label: "Arc Testnet",
    chainId: 5_042_002,
    caip2: "eip155:5042002",
    environment: "testnet",
    rpcUrls: ["https://rpc.testnet.arc.network"],
    explorerUrl: "",
    nativeAsset: asset({ symbol: "USDC", name: "Test USDC", decimals: 18, address: null }),
    paymentAsset: asset({
      symbol: "USDC",
      name: "Test USDC",
      decimals: 6,
      address: "0x3600000000000000000000000000000000000000",
    }),
    paymentProvider: "circle-gateway",
    tokenDiscoveryProvider: null,
    contractEvidenceProvider: "generic-evm",
    fundingOptions: ["circle-faucet", "gateway-deposit"],
  }),
});

export function parseEnabledNetworks(value: string): readonly NetworkKey[] {
  const requested = value.split(",").map((item) => item.trim()).filter(Boolean);
  const invalid = requested.filter((item) => !NETWORK_KEYS.includes(item as NetworkKey));
  if (invalid.length) throw new Error(`Unsupported ENABLED_NETWORKS value(s): ${invalid.join(", ")}`);
  const unique = [...new Set(requested)] as NetworkKey[];
  if (!unique.length) throw new Error("ENABLED_NETWORKS must contain at least one network");
  return Object.freeze(unique);
}

export function getNetwork(key: NetworkKey): PulseNetwork {
  return NETWORK_REGISTRY[key];
}

export function getNetworkByCaip2(caip2: string): PulseNetwork | undefined {
  return NETWORK_KEYS.map(getNetwork).find((item) => item.caip2 === caip2);
}

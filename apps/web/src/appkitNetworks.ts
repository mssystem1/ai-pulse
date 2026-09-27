import type { AppKitNetwork } from "@reown/appkit/networks";
import { ENABLED_WEB_NETWORKS, WEB_NETWORKS, type WebNetworkKey } from "./networks";

/** The wallet modal and PULSE selector must support the same chains. */
type PulseAppKitNetwork = AppKitNetwork & { chainNamespace: "eip155"; caipNetworkId: `eip155:${number}` };

export function buildAppKitNetworks(keys: readonly WebNetworkKey[]): [PulseAppKitNetwork, ...PulseAppKitNetwork[]] {
  const selected = keys.length ? [...new Set(keys)] : ["xlayer" as const];
  const convert = (key: WebNetworkKey): PulseAppKitNetwork => {
    const network = WEB_NETWORKS[key];
    return {
      id: network.chainId,
      chainNamespace: "eip155" as const,
      caipNetworkId: network.caip2,
      name: network.label,
      nativeCurrency: network.native,
      rpcUrls: { default: { http: [network.rpc] } },
      blockExplorers: { default: { name: `${network.label} Explorer`, url: network.explorer } },
      ...(key === "arc-testnet" ? { testnet: true } : {}),
    };
  };
  return [convert(selected[0]), ...selected.slice(1).map(convert)];
}

export const appKitNetworks = buildAppKitNetworks(ENABLED_WEB_NETWORKS);

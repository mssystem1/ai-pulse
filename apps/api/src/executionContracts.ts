export type ExecutionNetwork = "xlayer" | "base" | "arbitrum";

export type ExecutionContractKey =
  | "registry"
  | "oracleRouter"
  | "executionAdapter"
  | "spotFactory"
  | "spotLimitFactory"
  | "spotBracketFactory"
  | "autopilotFactory"
  | "okxRouter"
  | "okxApproval";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/**
 * Public, verified PULSE mainnet deployments. Environment variables remain an
 * override for an intentional contract migration, but an omitted Railway
 * variable must not silently remove an already-published product capability.
 */
export const PUBLISHED_EXECUTION_CONTRACTS = {
  xlayer: {
    registry: "0x814469ebed3a8466266a9fa9cdf78c381c16a146",
    oracleRouter: "0x3df7a41d0b07ffcd25ecba43e9b4620c627ba8b0",
    executionAdapter: "0x36080c7ef9b793dea9d821e8ee8447226ccf329a",
    spotFactory: "0x68faa8b82f9d305a193ba3640de9526479b66c54",
    spotLimitFactory: "0x3f53ed46e18152ac6903e49450e7b227b5236098",
    spotBracketFactory: "0x073784ac4aaadf755a887880280519535c584bfb",
    autopilotFactory: "0xd0fc9d162adde054479d7550a1b9a38f4a2ddc96",
    okxRouter: "0x7c5bee2a8091c3ef39072f64f18fac913060aeaf",
    okxApproval: "0x8b773D83bc66Be128c60e07E17C8901f7a64F000",
  },
  base: {
    registry: "0xa1fef7c527c0e039cb4724bd3a86ccfe49d4c169",
    oracleRouter: "0x1448df2bda5f9bd4a53c8e3fdb123d15e4e6e33d",
    executionAdapter: "0x7bd683fee53b3370cde105288180c5b66fb53c8f",
    spotFactory: "0x70c8fe8080e43e9e11e61cbaf1ce17b2754183b3",
    spotLimitFactory: "0x6d63ac4e6845298d7a79c69f63531695cdc5aaa7",
    spotBracketFactory: "0x9fb833745c28d0a91a0afb58e6ae64dc0637b4c1",
    autopilotFactory: "0x8eb18bdce830a7ec6e342c50d9f693f6d7b03cc2",
    okxRouter: "0x67d03631fe51b741c0c00c4e16eb662ac84381df",
    okxApproval: "0x57df6092665eb6058DE53939612413ff4B09114E",
  },
  arbitrum: {
    registry: "0xe54dc99228463dad2c4f2762c9e1baf2d6f2ee07",
    oracleRouter: "0xc2cf8dd0ba67142c539053c51fc1da9cc52e1af3",
    executionAdapter: "0x24eb07fdde101420dd9bf994674eee6043c99057",
    spotFactory: "0x951ac8cb1524a7856b2940966ab9751c2259af63",
    spotLimitFactory: "0x8f34357586bbb2c74d46b68ac71e8238bb3d7f63",
    spotBracketFactory: "0x80196239a939c4664cd1a12de3194c92685a929a",
    autopilotFactory: "0x45ba7d5282d0df187803f7f64ce9d7b8dbb4e8ed",
    okxRouter: "0x09f94b5fc68e227c323a6fbae3bd98c97fd8c849",
    okxApproval: "0x70cBb871E8f30Fc8Ce23609E9E0Ea87B6b222F58",
  },
} as const satisfies Record<ExecutionNetwork, Record<ExecutionContractKey, string>>;

const ENV_NAMES: Record<ExecutionNetwork, Record<ExecutionContractKey, string>> = {
  xlayer: {
    registry: "XLAYER_PULSE_REGISTRY_ADDRESS",
    oracleRouter: "XLAYER_ORACLE_ROUTER_ADDRESS",
    executionAdapter: "XLAYER_EXECUTION_ADAPTER_ADDRESS",
    spotFactory: "XLAYER_SPOT_ORDER_FACTORY_ADDRESS",
    spotLimitFactory: "XLAYER_SPOT_LIMIT_FACTORY_ADDRESS",
    spotBracketFactory: "XLAYER_SPOT_BRACKET_FACTORY_ADDRESS",
    autopilotFactory: "XLAYER_AUTOPILOT_VAULT_FACTORY_ADDRESS",
    okxRouter: "XLAYER_OKX_ROUTER_ADDRESS",
    okxApproval: "XLAYER_OKX_APPROVAL_ADDRESS",
  },
  base: {
    registry: "BASE_PULSE_REGISTRY_ADDRESS",
    oracleRouter: "BASE_ORACLE_ROUTER_ADDRESS",
    executionAdapter: "BASE_EXECUTION_ADAPTER_ADDRESS",
    spotFactory: "BASE_SPOT_ORDER_FACTORY_ADDRESS",
    spotLimitFactory: "BASE_SPOT_LIMIT_FACTORY_ADDRESS",
    spotBracketFactory: "BASE_SPOT_BRACKET_FACTORY_ADDRESS",
    autopilotFactory: "BASE_AUTOPILOT_VAULT_FACTORY_ADDRESS",
    okxRouter: "BASE_OKX_ROUTER_ADDRESS",
    okxApproval: "BASE_OKX_APPROVAL_ADDRESS",
  },
  arbitrum: {
    registry: "ARBITRUM_PULSE_REGISTRY_ADDRESS",
    oracleRouter: "ARBITRUM_ORACLE_ROUTER_ADDRESS",
    executionAdapter: "ARBITRUM_EXECUTION_ADAPTER_ADDRESS",
    spotFactory: "ARBITRUM_SPOT_ORDER_FACTORY_ADDRESS",
    spotLimitFactory: "ARBITRUM_SPOT_LIMIT_FACTORY_ADDRESS",
    spotBracketFactory: "ARBITRUM_SPOT_BRACKET_FACTORY_ADDRESS",
    autopilotFactory: "ARBITRUM_AUTOPILOT_VAULT_FACTORY_ADDRESS",
    okxRouter: "ARBITRUM_OKX_ROUTER_ADDRESS",
    okxApproval: "ARBITRUM_OKX_APPROVAL_ADDRESS",
  },
};

export function executionContractAddress(
  network: ExecutionNetwork,
  key: ExecutionContractKey,
): `0x${string}` {
  const configured = process.env[ENV_NAMES[network][key]]?.trim() || "";
  const value = ADDRESS.test(configured)
    ? configured
    : PUBLISHED_EXECUTION_CONTRACTS[network][key];
  return value as `0x${string}`;
}

export function executionContracts(network: ExecutionNetwork) {
  return {
    registry: executionContractAddress(network, "registry"),
    oracleRouter: executionContractAddress(network, "oracleRouter"),
    executionAdapter: executionContractAddress(network, "executionAdapter"),
    spotFactory: executionContractAddress(network, "spotFactory"),
    spotLimitFactory: executionContractAddress(network, "spotLimitFactory"),
    spotBracketFactory: executionContractAddress(network, "spotBracketFactory"),
    autopilotFactory: executionContractAddress(network, "autopilotFactory"),
  };
}

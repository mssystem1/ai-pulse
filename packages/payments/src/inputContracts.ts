export type X402InputField = {
  name: string;
  carrier: "body";
  type: "string" | "number";
  required: boolean;
  description: string;
  default?: string | number;
  enum?: string[];
  pattern?: string;
};

export type X402InputContract = {
  method: "POST";
  input: Record<string, Omit<X402InputField, "name">>;
};

type RouteInputDefinition = {
  message: string;
  requiredAnyOf?: string[];
  requiredArgs?: string[];
  fields: X402InputField[];
};

const EVM_ADDRESS_PATTERN = "^0x[a-fA-F0-9]{40}$";

const routeInputs: Record<string, RouteInputDefinition> = {
  "/v1/analysis/base": {
    message: "Provide an OKX spot instrument before requesting base analysis.",
    requiredArgs: ["instId"],
    fields: [
      {
        name: "instId",
        carrier: "body",
        type: "string",
        required: true,
        description: "OKX spot instrument ID, for example BTC-USDT.",
      },
      {
        name: "timeframe",
        carrier: "body",
        type: "string",
        required: false,
        default: "1H",
        description: "Candle timeframe.",
      },
      {
        name: "lang",
        carrier: "body",
        type: "string",
        required: false,
        default: "en",
        enum: ["en", "zh"],
        description: "Report language.",
      },
      {
        name: "userNote",
        carrier: "body",
        type: "string",
        required: false,
        description: "Optional focus note, maximum 500 characters.",
      },
    ],
  },
  "/v1/analysis/premium": {
    message: "Provide an OKX spot instrument before requesting premium analysis.",
    requiredArgs: ["instId"],
    fields: [
      {
        name: "instId",
        carrier: "body",
        type: "string",
        required: true,
        description: "OKX spot instrument ID, for example BTC-USDT.",
      },
      {
        name: "timeframe",
        carrier: "body",
        type: "string",
        required: false,
        default: "1H",
        description: "Candle timeframe.",
      },
      {
        name: "lang",
        carrier: "body",
        type: "string",
        required: false,
        default: "en",
        enum: ["en", "zh"],
        description: "Report language.",
      },
      {
        name: "userNote",
        carrier: "body",
        type: "string",
        required: false,
        description: "Optional focus note, maximum 500 characters.",
      },
    ],
  },
  "/v1/token/scan": {
    message: "Provide the X Layer token contract address to scan.",
    requiredArgs: ["address"],
    requiredAnyOf: ["address"],
    fields: [
      {
        name: "address",
        carrier: "body",
        type: "string",
        required: true,
        pattern: EVM_ADDRESS_PATTERN,
        description: "EVM token contract address on X Layer.",
      },
      {
        name: "chainId",
        carrier: "body",
        type: "string",
        required: false,
        default: "196",
        enum: ["196"],
        description: "X Layer chain ID. PULSE token safety is scoped to chain 196.",
      },
    ],
  },
  "/v1/preflight": {
    message: "Provide the intended X Layer action and any available trade context.",
    fields: [
      {
        name: "intent",
        carrier: "body",
        type: "string",
        required: false,
        default: "generic",
        enum: ["swap", "transfer", "approve", "hire_agent", "generic"],
        description: "Action to inspect.",
      },
      ...["tokenAddress", "walletAddress", "counterparty", "fromToken", "toToken"].map(
        (name): X402InputField => ({
          name,
          carrier: "body",
          type: "string",
          required: false,
          pattern: EVM_ADDRESS_PATTERN,
          description: `${name} EVM address when relevant.`,
        }),
      ),
      {
        name: "amount",
        carrier: "body",
        type: "string",
        required: false,
        description: "Human-readable amount when relevant.",
      },
      {
        name: "chainId",
        carrier: "body",
        type: "string",
        required: false,
        default: "196",
        enum: ["196"],
        description: "X Layer chain ID.",
      },
      {
        name: "notes",
        carrier: "body",
        type: "string",
        required: false,
        description: "Optional context, maximum 500 characters.",
      },
    ],
  },
  "/v1/wallet/scan": {
    message: "Provide the X Layer wallet or counterparty address to scan.",
    requiredArgs: ["address"],
    requiredAnyOf: ["address"],
    fields: [
      {
        name: "address",
        carrier: "body",
        type: "string",
        required: true,
        pattern: EVM_ADDRESS_PATTERN,
        description: "EVM wallet address on X Layer.",
      },
      {
        name: "chainId",
        carrier: "body",
        type: "string",
        required: false,
        default: "196",
        enum: ["196"],
        description: "X Layer chain ID.",
      },
    ],
  },
  "/v1/market/pulse": {
    message: "Provide either a token contract address or a token symbol.",
    requiredAnyOf: ["address", "symbol"],
    fields: [
      {
        name: "address",
        carrier: "body",
        type: "string",
        required: false,
        pattern: EVM_ADDRESS_PATTERN,
        description: "EVM token contract address.",
      },
      {
        name: "symbol",
        carrier: "body",
        type: "string",
        required: false,
        description: "Token symbol.",
      },
      {
        name: "chainId",
        carrier: "body",
        type: "string",
        required: false,
        default: "196",
        enum: ["196"],
        description: "X Layer chain ID.",
      },
    ],
  },
  "/v1/swap/quote": {
    message: "Provide fromToken, toToken, and amount for the heuristic quote.",
    requiredArgs: ["fromToken", "toToken", "amount"],
    fields: [
      {
        name: "fromToken",
        carrier: "body",
        type: "string",
        required: true,
        pattern: EVM_ADDRESS_PATTERN,
        description: "Input token contract address.",
      },
      {
        name: "toToken",
        carrier: "body",
        type: "string",
        required: true,
        pattern: EVM_ADDRESS_PATTERN,
        description: "Output token contract address.",
      },
      {
        name: "amount",
        carrier: "body",
        type: "string",
        required: true,
        description: "Input amount as a decimal string.",
      },
      {
        name: "chainId",
        carrier: "body",
        type: "string",
        required: false,
        default: "196",
        enum: ["196"],
        description: "X Layer chain ID.",
      },
      {
        name: "slippageBps",
        carrier: "body",
        type: "number",
        required: false,
        default: 50,
        description: "Slippage tolerance in basis points.",
      },
    ],
  },
};

export function getX402InputDefinition(path: string): RouteInputDefinition | undefined {
  return routeInputs[path];
}

export function getX402OutputSchema(path: string): X402InputContract | undefined {
  const definition = getX402InputDefinition(path);
  if (!definition) return undefined;
  return {
    method: "POST",
    input: Object.fromEntries(
      definition.fields.map(({ name, ...field }) => [name, field]),
    ),
  };
}

export function buildX402InputRequired(
  path: string,
  validationIssues?: Array<{ path?: PropertyKey[]; message: string }>,
) {
  const definition = getX402InputDefinition(path);
  if (!definition) {
    return {
      status: "input_required",
      message: "This paid endpoint requires a JSON request body.",
      fields: [],
    };
  }
  return {
    status: "input_required",
    message: definition.message,
    requiredAnyOf: definition.requiredAnyOf,
    requiredArgs: definition.requiredArgs,
    fields: definition.fields,
    validationErrors: validationIssues?.map((issue) => ({
      field: issue.path?.map(String).join(".") || "body",
      message: issue.message,
    })),
    outputSchema: getX402OutputSchema(path),
  };
}

export function buildX402PaymentRequiredBody(path: string) {
  return {
    status: "payment_required",
    message: "Settle the x402 payment, then replay this POST with the same JSON body.",
    outputSchema: getX402OutputSchema(path),
  };
}

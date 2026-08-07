export type X402InputField = {
  name: string;
  carrier: "body";
  type: "string" | "number" | "array";
  required: boolean;
  description: string;
  default?: string | number;
  enum?: string[];
  pattern?: string;
};

export type X402InputContract = {
  method: "POST";
  input: Record<string, Omit<X402InputField, "name">>;
  output?: Record<string, unknown>;
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

routeInputs["/v1/analysis/spot/standard"] = routeInputs["/v1/analysis/base"];
routeInputs["/v1/analysis/spot/premium"] = routeInputs["/v1/analysis/premium"];

const predictionFields: X402InputField[] = [
  { name: "primaryMarketId", carrier: "body", type: "string", required: true, description: "Explicit Polymarket market or pm:condition ID." },
  { name: "additionalMarketIds", carrier: "body", type: "array", required: false, description: "Optional array of additional explicitly selected market IDs." },
  { name: "lang", carrier: "body", type: "string", required: false, default: "en", enum: ["en", "zh"], description: "Report language." },
  { name: "userNote", carrier: "body", type: "string", required: false, description: "Optional focus note, maximum 500 characters." },
];
for (const path of ["/v1/analysis/prediction/standard", "/v1/analysis/prediction/premium"]) {
  routeInputs[path] = { message: "Select the primary Polymarket market before requesting payment.", requiredArgs: ["primaryMarketId"], fields: predictionFields };
}
const fusedFields: X402InputField[] = [
  { name: "instId", carrier: "body", type: "string", required: true, description: "OKX spot instrument ID, for example BTC-USDT." },
  { name: "timeframe", carrier: "body", type: "string", required: false, default: "1H", description: "Spot candle timeframe." },
  ...predictionFields,
];
for (const path of ["/v1/analysis/fused/standard", "/v1/analysis/fused/premium", "/v1/analysis/divergence"]) {
  routeInputs[path] = { message: "Provide an OKX instrument and explicit primary Polymarket market.", requiredArgs: ["instId", "primaryMarketId"], fields: fusedFields };
}
routeInputs["/v1/preflight/event-risk"] = {
  message: "Select the primary Polymarket market for event-risk preflight.", requiredArgs: ["primaryMarketId"],
  fields: [
    ...predictionFields,
    { name: "intent", carrier: "body", type: "string", required: false, default: "generic", enum: ["swap", "transfer", "approve", "hire_agent", "generic"], description: "Action being checked." },
    { name: "tokenAddress", carrier: "body", type: "string", required: false, pattern: EVM_ADDRESS_PATTERN, description: "Optional token contract." },
    { name: "walletAddress", carrier: "body", type: "string", required: false, pattern: EVM_ADDRESS_PATTERN, description: "Optional wallet address." },
    { name: "amount", carrier: "body", type: "string", required: false, description: "Optional action amount." },
  ],
};

export function getX402InputDefinition(path: string): RouteInputDefinition | undefined {
  return routeInputs[path];
}

export function getX402OutputSchema(path: string): X402InputContract | undefined {
  const definition = getX402InputDefinition(path);
  if (!definition) return undefined;
  const asynchronous = [
    "/v1/analysis/spot/standard", "/v1/analysis/spot/premium",
    "/v1/analysis/prediction/standard", "/v1/analysis/prediction/premium",
    "/v1/analysis/fused/standard", "/v1/analysis/fused/premium",
    "/v1/analysis/divergence", "/v1/preflight/event-risk",
  ].includes(path);
  return {
    method: "POST",
    input: Object.fromEntries(
      definition.fields.map(({ name, ...field }) => [name, field]),
    ),
    ...(asynchronous ? { output: {
      status: 202,
      delivery: "durable_job",
      fields: {
        job: { type: "object", description: "Persisted job and current stage." },
        recoveryToken: { type: "string", description: "Opaque capability returned once for authenticated polling." },
        pollUrl: { type: "string", description: "GET with PULSE-RECOVERY-TOKEN; never submit another payment to poll." },
      },
      terminalStages: ["completed", "completed_partial", "failed_terminal", "manual_reconciliation"],
      reportPath: "/v1/jobs/{jobId}/report",
    } } : {}),
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

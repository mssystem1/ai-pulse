import type {
  MarketPulseRequest,
  MarketPulseResponse,
  PreflightRequest,
  PreflightResponse,
  ResolveRequest,
  ResolveResponse,
  SwapQuoteRequest,
  SwapQuoteResponse,
  TokenScanRequest,
  TokenScanResponse,
  WalletScanRequest,
  WalletScanResponse,
} from "@pulse/schemas";

export type PulseClientOptions = {
  baseUrl: string;
  /** Payment signature for x402 (agent wallet / facilitator). Required for paid routes. */
  paymentSignature?: string | (() => string | Promise<string>);
  fetchImpl?: typeof fetch;
};

export class PulseError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = "PulseError";
  }
}

export class PulsePaymentRequired extends PulseError {
  constructor(
    public paymentRequiredHeader: string | null,
    body: unknown,
  ) {
    super("Payment Required (HTTP 402)", 402, body);
    this.name = "PulsePaymentRequired";
  }
}

export class PulseClient {
  private baseUrl: string;
  private paymentSignature?: string | (() => string | Promise<string>);
  private fetchImpl: typeof fetch;

  constructor(opts: PulseClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.paymentSignature = opts.paymentSignature;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async meta(): Promise<unknown> {
    return this.request("GET", "/v1/meta");
  }

  async health(): Promise<unknown> {
    return this.request("GET", "/healthz");
  }

  async resolve(body: ResolveRequest): Promise<ResolveResponse> {
    return this.request("POST", "/v1/resolve", body, false) as Promise<ResolveResponse>;
  }

  async tokenScan(body: TokenScanRequest): Promise<TokenScanResponse> {
    return this.request("POST", "/v1/token/scan", body, true) as Promise<TokenScanResponse>;
  }

  async walletScan(body: WalletScanRequest): Promise<WalletScanResponse> {
    return this.request("POST", "/v1/wallet/scan", body, true) as Promise<WalletScanResponse>;
  }

  async marketPulse(body: MarketPulseRequest): Promise<MarketPulseResponse> {
    return this.request("POST", "/v1/market/pulse", body, true) as Promise<MarketPulseResponse>;
  }

  async swapQuote(body: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    return this.request("POST", "/v1/swap/quote", body, true) as Promise<SwapQuoteResponse>;
  }

  async preflight(body: PreflightRequest): Promise<PreflightResponse> {
    return this.request("POST", "/v1/preflight", body, true) as Promise<PreflightResponse>;
  }

  async getReport(shareId: string): Promise<PreflightResponse> {
    return this.request("GET", `/v1/reports/${shareId}`) as Promise<PreflightResponse>;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    paid = false,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (paid && this.paymentSignature) {
      const sig =
        typeof this.paymentSignature === "function"
          ? await this.paymentSignature()
          : this.paymentSignature;
      if (sig) headers["PAYMENT-SIGNATURE"] = sig;
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    if (res.status === 402) {
      throw new PulsePaymentRequired(
        res.headers.get("PAYMENT-REQUIRED") ?? res.headers.get("payment-required"),
        json,
      );
    }
    if (!res.ok) {
      throw new PulseError(`HTTP ${res.status}`, res.status, json);
    }
    return json;
  }
}

export type {
  MarketPulseRequest,
  MarketPulseResponse,
  PreflightRequest,
  PreflightResponse,
  ResolveRequest,
  ResolveResponse,
  SwapQuoteRequest,
  SwapQuoteResponse,
  TokenScanRequest,
  TokenScanResponse,
  WalletScanRequest,
  WalletScanResponse,
};

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
  PredictionAnalysisRequest,
  PredictionAnalysisResponse,
  FusedAnalysisRequest,
  FusedAnalysisResponse,
  DivergenceAnalysisRequest,
  DivergenceAnalysisResponse,
  EventRiskPreflightRequest,
  EventRiskPreflightResponse,
} from "@pulse/schemas";

export type PulseClientOptions = {
  baseUrl: string;
  /** Payment signature for x402 (agent wallet / facilitator). Required for paid routes. */
  paymentSignature?: string | (() => string | Promise<string>);
  fetchImpl?: typeof fetch;
};

export type PulseJob = {
  id: string;
  mode: "spot" | "prediction" | "fused" | "divergence" | "event-risk";
  tier: "standard" | "premium" | null;
  network: string;
  stage: string;
  reportId: string | null;
  events: Array<{ stage: string; at: string; detail?: string }>;
  receipt?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type PulseJobAccepted = {
  job: PulseJob;
  recoveryToken?: string;
  pollUrl?: string;
  replay?: boolean;
};

export type PulseJobReport<T> = { report: T; metadata: unknown; job: PulseJob };

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

  async predictionAnalysis(body: PredictionAnalysisRequest, tier: "standard" | "premium" = "standard"): Promise<PulseJobAccepted> {
    return this.request("POST", `/v1/analysis/prediction/${tier}`, body, true) as Promise<PulseJobAccepted>;
  }

  async fusedAnalysis(body: FusedAnalysisRequest, tier: "standard" | "premium" = "standard"): Promise<PulseJobAccepted> {
    return this.request("POST", `/v1/analysis/fused/${tier}`, body, true) as Promise<PulseJobAccepted>;
  }

  async divergenceAnalysis(body: DivergenceAnalysisRequest): Promise<PulseJobAccepted> {
    return this.request("POST", "/v1/analysis/divergence", body, true) as Promise<PulseJobAccepted>;
  }

  async eventRiskPreflight(body: EventRiskPreflightRequest): Promise<PulseJobAccepted> {
    return this.request("POST", "/v1/preflight/event-risk", body, true) as Promise<PulseJobAccepted>;
  }

  async getJob(jobId: string, recoveryToken: string): Promise<{ job: PulseJob; storedReport?: unknown }> {
    return this.request("GET", `/v1/jobs/${encodeURIComponent(jobId)}`, undefined, false, {
      "PULSE-RECOVERY-TOKEN": recoveryToken,
    }) as Promise<{ job: PulseJob; storedReport?: unknown }>;
  }

  async getJobReport<T = unknown>(jobId: string, recoveryToken: string): Promise<PulseJobReport<T>> {
    return this.request("GET", `/v1/jobs/${encodeURIComponent(jobId)}/report`, undefined, false, {
      "PULSE-RECOVERY-TOKEN": recoveryToken,
    }) as Promise<PulseJobReport<T>>;
  }

  async waitForJobReport<T = unknown>(accepted: PulseJobAccepted, options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<PulseJobReport<T>> {
    if (!accepted.recoveryToken) throw new PulseError("This replay response does not contain the one-time recovery capability; use the token saved from the original 202 response", 403, accepted);
    const intervalMs = Math.max(250, options.intervalMs ?? 1_000);
    const timeoutMs = Math.max(intervalMs, options.timeoutMs ?? 120_000);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw new DOMException("Polling aborted", "AbortError");
      const status = await this.getJob(accepted.job.id, accepted.recoveryToken);
      if (status.job.stage === "completed" || status.job.stage === "completed_partial") {
        return this.getJobReport<T>(accepted.job.id, accepted.recoveryToken);
      }
      if (status.job.stage === "failed_terminal" || status.job.stage === "manual_reconciliation") {
        throw new PulseError(`Job ended in ${status.job.stage}`, 409, status);
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, intervalMs);
        options.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Polling aborted", "AbortError")); }, { once: true });
      });
    }
    throw new PulseError("Timed out waiting for report; keep the recovery token and poll again without paying", 408, accepted);
  }

  async getReport(shareId: string): Promise<PreflightResponse> {
    return this.request("GET", `/v1/reports/${shareId}`) as Promise<PreflightResponse>;
  }

  async getPrivateReport(reportId: string): Promise<unknown> {
    return this.request("GET", `/v1/private/reports/${encodeURIComponent(reportId)}`, undefined, true);
  }

  async createReportShare(reportId: string): Promise<{ reportId: string; shareToken: string; shareUrl: string }> {
    return this.request("POST", `/v1/private/reports/${encodeURIComponent(reportId)}/shares`, {}, true) as Promise<{ reportId: string; shareToken: string; shareUrl: string }>;
  }

  async revokeReportShare(reportId: string, shareToken: string): Promise<void> {
    await this.request("DELETE", `/v1/private/reports/${encodeURIComponent(reportId)}/shares/${encodeURIComponent(shareToken)}`, undefined, true);
  }

  async getSharedReport(shareToken: string): Promise<unknown> {
    return this.request("GET", `/v1/shared/reports/${encodeURIComponent(shareToken)}`);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    paid = false,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...extraHeaders,
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

    const json = res.status === 204 ? undefined : await res.json().catch(() => ({}));
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
  PredictionAnalysisRequest,
  PredictionAnalysisResponse,
  FusedAnalysisRequest,
  FusedAnalysisResponse,
  DivergenceAnalysisRequest,
  DivergenceAnalysisResponse,
  EventRiskPreflightRequest,
  EventRiskPreflightResponse,
};

type AnyRec = Record<string, unknown>;

function gradeClass(grade: string): string {
  if (grade === "A" || grade === "B") return "good";
  if (grade === "C") return "mid";
  return "bad";
}

function verdictClass(v: string): string {
  if (v === "PASS") return "good";
  if (v === "WARN") return "mid";
  return "bad";
}

export function ContractEvidenceReport({ data }: { data: AnyRec }) {
  const inspection = ((data.inspection as AnyRec) || data);
  const proxy = (inspection.proxy as AnyRec) || {};
  const deployed = Boolean(inspection.deployed);
  const methods = Array.isArray(inspection.rpcMethodSet) ? (inspection.rpcMethodSet as string[]) : [];
  const limitations = Array.isArray(data.limitations) ? (data.limitations as string[]) : Array.isArray(inspection.limitations) ? (inspection.limitations as string[]) : [];
  const token = (data.tokenInterface as AnyRec) || null;
  const tokenField = (name: string) => {
    const item = token?.[name] as AnyRec | undefined;
    return item?.status === "observed" ? String(item.value) : "unknown";
  };

  return (
    <div className="sr contract-evidence">
      <div className="sr-title-row">
        <span className={`sr-pill ${deployed ? "good" : "mid"}`}>
          {deployed ? "BYTECODE FOUND" : "NO BYTECODE"}
        </span>
        <span className="sr-pill muted-pill">{String(inspection.network || "EVM network")} · chain {String(inspection.chainId || "—")}</span>
        <span className="sr-pill muted-pill">block {String(inspection.observedAtBlock || "—")}</span>
      </div>
      <h3 className="sr-headline">Live contract evidence</h3>
      <p className="sr-sub mono">{String(inspection.address || "")}</p>

      <div className="evidence-grid">
        <div><span>Account state</span><strong>{String(inspection.accountType || "—")}</strong></div>
        <div><span>Runtime bytecode</span><strong>{Number(inspection.bytecodeSize || 0).toLocaleString()} bytes</strong></div>
        <div><span>Transaction count</span><strong>{String(inspection.transactionCount || "0")}</strong></div>
        <div><span>Common proxy</span><strong>{proxy.detected ? String(proxy.standard || "detected") : "not detected"}</strong></div>
        {token && <><div><span>ERC-20 symbol</span><strong>{tokenField("symbol")}</strong></div><div><span>ERC-20 decimals</span><strong>{tokenField("decimals")}</strong></div><div><span>Total supply (atomic)</span><strong>{tokenField("totalSupply")}</strong></div><div><span>Safety verdict</span><strong>unknown</strong></div></>}
      </div>

      {proxy.implementation ? (
        <div className="evidence-line"><span>Implementation</span><code>{String(proxy.implementation)}</code></div>
      ) : null}
      {inspection.bytecodeSha256 ? (
        <div className="evidence-line"><span>Bytecode SHA-256</span><code>{String(inspection.bytecodeSha256)}</code></div>
      ) : null}

      <div className="rpc-proof">
        <span className="scope-dot" />
        <div><strong>Observed from the selected network RPC</strong><p>{methods.join(" · ")}</p></div>
      </div>
      <p className="sr-summary">{String(data.conclusion || "")}</p>

      <div className="sr-section">What this does not prove</div>
      <ul className="sr-list">
        {limitations.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

export function SafetyTokenReport({ data }: { data: AnyRec }) {
  const grade = String(data.grade ?? "—");
  const verdict = String(data.verdict ?? "—");
  const score = data.riskScore;
  const components = Array.isArray(data.components) ? (data.components as AnyRec[]) : [];
  const flags = Array.isArray(data.flags) ? (data.flags as string[]) : [];

  return (
    <div className="sr">
      <div className="sr-hero">
        <div className={`sr-ring ${gradeClass(grade)}`}>
          <strong>{typeof score === "number" ? score.toFixed(0) : "—"}</strong>
          <span>score</span>
        </div>
        <div>
          <div className="sr-title-row">
            <h3>
              {String(data.symbol || "Token")}{" "}
              <span className="muted">{String(data.name || "")}</span>
            </h3>
            <span className={`sr-pill ${verdictClass(verdict)}`}>{verdict}</span>
            <span className={`sr-pill ${gradeClass(grade)}`}>Grade {grade}</span>
          </div>
          <p className="sr-sub mono">{String(data.address || "")}</p>
          <div className="sr-meta">
            <span>Liquidity ≈ ${Number(data.liquidityUsd || 0).toLocaleString()}</span>
            <span>Holders ≈ {Number(data.holdersEstimate || 0).toLocaleString()}</span>
            <span>Age ≈ {Number(data.contractAgeDays || 0)}d</span>
            <span>{data.isVerified ? "Verified signal" : "Unverified"}</span>
          </div>
        </div>
      </div>

      {flags.length > 0 && (
        <div className="sr-flags">
          {flags.map((f) => (
            <span key={f} className="sr-flag">
              {f}
            </span>
          ))}
        </div>
      )}

      <div className="sr-section">Risk breakdown</div>
      <div className="sr-components">
        {components.map((c) => (
          <div key={String(c.key)} className="sr-comp">
            <div className="sr-comp-top">
              <b>{String(c.label || c.key)}</b>
              <span>{Number(c.score)} / 100</span>
            </div>
            <div className="sr-bar">
              <i style={{ width: `${Math.min(100, Number(c.score) || 0)}%` }} />
            </div>
            <p>{String(c.reason || "")}</p>
          </div>
        ))}
      </div>

      {Array.isArray(data.limitations) && (
        <>
          <div className="sr-section">Limitations</div>
          <ul className="sr-list">
            {(data.limitations as string[]).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function SafetyPreflightReport({ data }: { data: AnyRec }) {
  const grade = String(data.grade ?? "—");
  const verdict = String(data.verdict ?? "—");
  const score = data.overallScore;
  const checklist = Array.isArray(data.checklist) ? (data.checklist as AnyRec[]) : [];
  const recs = Array.isArray(data.recommendations) ? (data.recommendations as string[]) : [];

  return (
    <div className="sr">
      <div className="sr-hero">
        <div className={`sr-ring ${verdictClass(verdict)}`}>
          <strong>{typeof score === "number" ? score.toFixed(0) : "—"}</strong>
          <span>overall</span>
        </div>
        <div>
          <div className="sr-title-row">
            <h3>{String(data.headline || "Pre-trade check")}</h3>
          </div>
          <div className="sr-title-row" style={{ marginTop: 6 }}>
            <span className={`sr-pill ${verdictClass(verdict)}`}>{verdict}</span>
            <span className={`sr-pill ${gradeClass(grade)}`}>Grade {grade}</span>
            <span className="sr-pill muted-pill">intent {String(data.intent || "—")}</span>
          </div>
        </div>
      </div>

      <div className="sr-section">Checklist</div>
      <div className="sr-checks">
        {checklist.map((c) => {
          const st = String(c.status || "skip");
          return (
            <div key={String(c.id)} className={`sr-check ${st}`}>
              <div className={`dot ${st}`} />
              <div>
                <b>{String(c.title)}</b>
                <p>{String(c.detail)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {recs.length > 0 && (
        <>
          <div className="sr-section">Recommendations</div>
          <ul className="sr-list">
            {recs.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}

      {data.token != null && typeof data.token === "object" ? (
        <>
          <div className="sr-section">Embedded token scan</div>
          <SafetyTokenReport data={data.token as AnyRec} />
        </>
      ) : null}
    </div>
  );
}

export function AnalysisReport({ data, nfa }: { data: AnyRec; nfa: string }) {
  const a = (data.analysis as AnyRec) || {};
  const bias = String(a.bias || "—");
  const badgeClass = bias === "bearish" ? "bad" : bias === "neutral" ? "mid" : "good";
  const targets = Array.isArray(a.targets) ? (a.targets as AnyRec[]) : [];
  const checklist = Array.isArray(a.agentChecklist) ? (a.agentChecklist as string[]) : [];
  const scenarios = Array.isArray(a.scenarios) ? (a.scenarios as AnyRec[]) : [];

  return (
    <div className="sr">
      <div className="sr-title-row">
        <span className={`sr-pill ${badgeClass}`}>
          {bias} · {String(a.confidence ?? "—")}%
        </span>
        <span className="sr-pill muted-pill">{String(data.tier || data.service)}</span>
      </div>
      <h3 className="sr-headline">{String(a.headline || "")}</h3>
      <p className="sr-summary">{String(a.summary || "")}</p>

      {targets.length > 0 && (
        <>
          <div className="sr-section">Price targets</div>
          <div className="sr-targets">
            {targets.map((t, i) => (
              <div key={i} className="sr-target">
                <b>{String(t.label || "Target")}</b>
                <strong>{String(t.price ?? "—")}</strong>
                <p>{String(t.rationale || "")}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {a.keyLevels != null && (
        <>
          <div className="sr-section">Key levels</div>
          <div className="sr-levels">
            {(["support", "resistance"] as const).map((k) => {
              const levels = (a.keyLevels as AnyRec)?.[k];
              if (!Array.isArray(levels)) return null;
              return (
                <div key={k}>
                  <span className="muted">{k}</span>
                  <div className="sr-flags">
                    {levels.map((lv, i) => (
                      <span key={i} className="sr-flag">
                        {String(lv)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {a.invalidation != null && (
        <>
          <div className="sr-section">Invalidation</div>
          <p className="sr-summary">
            {typeof a.invalidation === "object"
              ? `${(a.invalidation as AnyRec).price ?? "—"} — ${String((a.invalidation as AnyRec).condition || "")}`
              : String(a.invalidation)}
          </p>
        </>
      )}

      {scenarios.length > 0 && (
        <>
          <div className="sr-section">Scenarios</div>
          <div className="sr-targets">
            {scenarios.map((s, i) => (
              <div key={i} className="sr-target">
                <b>{String(s.name || "scenario")}</b>
                <strong>tgt {String(s.target ?? "—")}</strong>
                <p>{String(s.thesis || "")}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {checklist.length > 0 && (
        <>
          <div className="sr-section">Agent checklist</div>
          <ul className="sr-list">
            {checklist.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}

      <div className="sr-section">Disclaimer</div>
      <p className="sr-summary">{String(a.disclaimer || nfa)}</p>
    </div>
  );
}

export function PredictionAnalysisReport({ data }: { data: AnyRec }) {
  const analysis = (data.analysis as AnyRec) || {};
  const predictionContext = (data.predictionContext as AnyRec) || {};
  const markets = Array.isArray(predictionContext.markets) ? predictionContext.markets as AnyRec[] : [];
  const primary = markets[0] || {};
  const market = (primary.market as AnyRec) || {};
  const outcomes = Array.isArray(primary.outcomes) ? primary.outcomes as AnyRec[] : [];
  const invalidations = Array.isArray(analysis.invalidationConditions) ? analysis.invalidationConditions as string[] : [];
  const limitations = Array.isArray(analysis.limitations) ? analysis.limitations as string[] : [];
  const list = (key: string) => Array.isArray(analysis[key]) ? analysis[key] as string[] : [];
  const evidenceDrivers = list("evidenceDrivers"); const counterEvidence = list("counterEvidence");
  const entryConditions = list("entryConditions"); const noTradeConditions = list("noTradeConditions");
  const catalystsForYes = list("catalystsForYes"); const catalystsForNo = list("catalystsForNo"); const executionRisks = list("executionRisks");
  const fair = (analysis.fairProbabilityRange as AnyRec) || {};
  const decision = (analysis.decision as AnyRec) || {};
  const action = String(decision.action || "WAIT");
  const actionClass = action === "CONSIDER_YES" ? "good" : action === "CONSIDER_NO" ? "bad" : "mid";
  const confidence = Number(analysis.confidence);
  const confidenceClass = confidence >= 70 ? "good" : confidence >= 45 ? "mid" : "bad";
  const profile = (data.analysisProfile as AnyRec) || {};

  return (
    <div className="sr prediction-analysis-report">
      <div className="sr-title-row">
        <span className={`sr-pill ${confidenceClass}`}>{Number.isFinite(confidence) ? `${confidence}% confidence` : "Confidence unavailable"}</span>
        <span className="sr-pill muted-pill">{String(data.tier || "prediction")}</span>
        {Boolean(profile.mode) && <span className="sr-pill muted-pill">{String(profile.mode)} · {String(profile.model || "AI")}</span>}
      </div>
      <h3 className="sr-headline">{String(analysis.headline || "Prediction market analysis")}</h3>
      <p className="sr-summary">{String(analysis.summary || "No narrative summary was returned.")}</p>

      <div className="sr-section">Decision framework</div>
      <div className="sr-title-row">
        <span className={`sr-pill ${actionClass}`}>{action.replaceAll("_", " ")}</span>
        <span className="sr-pill muted-pill">stance {String(analysis.stance || "NO_EDGE").replaceAll("_", " ")}</span>
      </div>
      <div className="prediction-report-outcomes">
        <div className="sr-target"><b>Market probability</b><strong>{Number.isFinite(Number(analysis.marketProbabilityPct)) ? `${Number(analysis.marketProbabilityPct).toFixed(1)}%` : "Unavailable"}</strong><p>Primary YES-like outcome; use the live bid/ask below for execution.</p></div>
        <div className="sr-target"><b>Evidence-based fair range</b><strong>{Number.isFinite(Number(fair.low)) && Number.isFinite(Number(fair.high)) ? `${Number(fair.low).toFixed(1)}–${Number(fair.high).toFixed(1)}%` : "Unavailable"}</strong><p>Conservative range, not a guaranteed forecast.</p></div>
      </div>
      <p className="sr-summary"><strong>{action.replaceAll("_", " ")}:</strong> {String(decision.rationale || "No decision rationale returned.")}</p>

      {(entryConditions.length > 0 || noTradeConditions.length > 0) && <>
        <div className="sr-section">When to act — and when not to</div>
        <div className="sr-targets">
          <div className="sr-target"><b>Entry conditions</b><ul className="sr-list">{entryConditions.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div className="sr-target"><b>No-trade conditions</b><ul className="sr-list">{noTradeConditions.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
      </>}

      {(evidenceDrivers.length > 0 || counterEvidence.length > 0) && <>
        <div className="sr-section">Evidence versus counter-case</div>
        <div className="sr-targets">
          <div className="sr-target"><b>Supports the lean</b><ul className="sr-list">{evidenceDrivers.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div className="sr-target"><b>Challenges the lean</b><ul className="sr-list">{counterEvidence.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
      </>}

      {(catalystsForYes.length > 0 || catalystsForNo.length > 0) && <>
        <div className="sr-section">Catalyst map</div>
        <div className="sr-targets">
          <div className="sr-target"><b>Moves probability toward YES</b><ul className="sr-list">{catalystsForYes.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div className="sr-target"><b>Moves probability toward NO</b><ul className="sr-list">{catalystsForNo.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
      </>}

      {(Boolean(market.question) || outcomes.length > 0) && <>
        <div className="sr-section">Market snapshot</div>
        {Boolean(market.question) && <p className="prediction-report-question">{String(market.question)}</p>}
        <div className="prediction-report-outcomes">
          {outcomes.map((outcome, index) => {
            const features = (outcome.features as AnyRec) || {};
            const probability = Number(features.midpointProbability);
            const bid = Number(features.bestBid);
            const ask = Number(features.bestAsk);
            return <div className="sr-target" key={`${String(outcome.name)}-${index}`}>
              <b>{String(outcome.name || `Outcome ${index + 1}`)}</b>
              <strong>{Number.isFinite(probability) ? `${(probability * 100).toFixed(1)}%` : "Unavailable"}</strong>
              <p>{Number.isFinite(bid) && Number.isFinite(ask) ? `Bid ${(bid * 100).toFixed(1)}% · Ask ${(ask * 100).toFixed(1)}%` : "Live bid/ask unavailable"}</p>
              <div className="sr-flags prediction-quality-flags">
                {Boolean(features.spreadQuality) && <span className="sr-flag">{String(features.spreadQuality)} spread</span>}
                {Boolean(features.liquidityQuality) && <span className="sr-flag">{String(features.liquidityQuality)} liquidity</span>}
                {features.stale === true && <span className="sr-flag warning-flag">stale evidence</span>}
              </div>
            </div>;
          })}
        </div>
        <div className="sr-meta prediction-report-meta">
          {market.liquidityUsd != null && <span>Liquidity ${Number(market.liquidityUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
          {market.volumeUsd != null && <span>Volume ${Number(market.volumeUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
          {primary.openInterest != null && <span>Open interest ${Number(primary.openInterest).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
          {Boolean(market.endDate) && <span>Ends {new Date(String(market.endDate)).toLocaleString()}</span>}
        </div>
      </>}

      {invalidations.length > 0 && <>
        <div className="sr-section">What would invalidate this report</div>
        <ul className="sr-list">{invalidations.map((item) => <li key={item}>{item}</li>)}</ul>
      </>}

      {limitations.length > 0 && <>
        <div className="sr-section">Risks and limitations</div>
        <ul className="sr-list">{limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      </>}

      {executionRisks.length > 0 && <>
        <div className="sr-section">Execution checklist</div>
        <ul className="sr-list">{executionRisks.map((item) => <li key={item}>{item}</li>)}</ul>
      </>}

      <div className="sr-section">Evidence</div>
      <div className="sr-meta">
        <span>{predictionContext.partial === true ? "Partial evidence" : "All requested public sources available"}</span>
        <span>Selection: {String(predictionContext.selectionMode || "user")}</span>
        {Boolean(data.methodology_version) && <span>Methodology {String(data.methodology_version)}</span>}
        {Boolean(data.generatedAt) && <span>Generated {new Date(String(data.generatedAt)).toLocaleString()}</span>}
      </div>

      <div className="sr-section">Disclaimer</div>
      <p className="sr-summary">{String(analysis.disclaimer || "Prediction-market probabilities are not facts or financial advice.")}</p>

      <details className="raw-details">
        <summary>Technical details</summary>
        <pre className="raw">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}

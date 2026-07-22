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
  const proxy = (data.proxy as AnyRec) || {};
  const deployed = Boolean(data.deployed);
  const methods = Array.isArray(data.rpcMethodSet) ? (data.rpcMethodSet as string[]) : [];
  const limitations = Array.isArray(data.limitations) ? (data.limitations as string[]) : [];

  return (
    <div className="sr contract-evidence">
      <div className="sr-title-row">
        <span className={`sr-pill ${deployed ? "good" : "mid"}`}>
          {deployed ? "BYTECODE FOUND" : "NO BYTECODE"}
        </span>
        <span className="sr-pill muted-pill">X Layer · chain 196</span>
        <span className="sr-pill muted-pill">block {String(data.observedAtBlock || "—")}</span>
      </div>
      <h3 className="sr-headline">Live contract evidence</h3>
      <p className="sr-sub mono">{String(data.address || "")}</p>

      <div className="evidence-grid">
        <div><span>Account state</span><strong>{String(data.accountType || "—")}</strong></div>
        <div><span>Runtime bytecode</span><strong>{Number(data.bytecodeSize || 0).toLocaleString()} bytes</strong></div>
        <div><span>Transaction count</span><strong>{String(data.transactionCount || "0")}</strong></div>
        <div><span>Common proxy</span><strong>{proxy.detected ? String(proxy.standard || "detected") : "not detected"}</strong></div>
      </div>

      {proxy.implementation ? (
        <div className="evidence-line"><span>Implementation</span><code>{String(proxy.implementation)}</code></div>
      ) : null}
      {data.bytecodeSha256 ? (
        <div className="evidence-line"><span>Bytecode SHA-256</span><code>{String(data.bytecodeSha256)}</code></div>
      ) : null}

      <div className="rpc-proof">
        <span className="scope-dot" />
        <div><strong>Observed from X Layer RPC</strong><p>{methods.join(" · ")}</p></div>
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

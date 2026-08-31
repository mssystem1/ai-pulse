import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type AnyRec = Record<string, unknown>;

export type ReportTradeIntent = {
  pair: string;
  timeframe: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  entryPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  downsideReference?: number;
  rationale: string;
  sourceTier: string;
};

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

export function AnalysisReport({ data, nfa, onTrade }: { data: AnyRec; nfa: string; onTrade?: (intent: ReportTradeIntent) => void }) {
  const a = (data.analysis as AnyRec) || {};
  const bias = String(a.bias || "—");
  const badgeClass = bias === "bearish" ? "bad" : bias === "neutral" ? "mid" : "good";
  const targets = Array.isArray(a.targets) ? (a.targets as AnyRec[]) : [];
  const checklist = Array.isArray(a.agentChecklist) ? (a.agentChecklist as string[]) : [];
  const legacyScenarios = Array.isArray(a.scenarios) ? (a.scenarios as AnyRec[]) : [];
  const elliottWave = (a.elliottWave as AnyRec) || {};
  const wavePaths = Array.isArray(elliottWave.paths) ? elliottWave.paths as AnyRec[] : [];

  const tier = String(data.tier || data.service).toLowerCase();
  const premium = tier.includes("premium");
  const technical = (data.technical as AnyRec) || {};
  const chart = (data.chart as AnyRec) || {};
  const execution = (data.executionPlan as AnyRec) || {};
  const recommendation = (execution.recommendation as AnyRec) || {};
  const buyPlan = (execution.buy as AnyRec) || {};
  const riskExit = (execution.riskExit as AnyRec) || (execution.sell as AnyRec) || {};
  const pair = String(execution.pair || data.instId || "");
  const reportTimeframe = String(execution.timeframe || data.timeframe || "");
  const [executionChoice, setExecutionChoice] = useState<"market" | "limit">(buyPlan.orderType === "limit" ? "limit" : "market");
  const buyIntent = (orderType: "market" | "limit"): ReportTradeIntent => ({ pair, timeframe: reportTimeframe, side: "buy", orderType, entryPrice: Number(buyPlan.trigger) || undefined, takeProfit: Number(buyPlan.takeProfit) || undefined, stopLoss: Number(buyPlan.stopLoss) || undefined, rationale: String(buyPlan.scenario || recommendation.reason || "Report buy setup"), sourceTier: tier });
  return (
    <div className={`sr tiered-report ${premium ? "premium-report" : "base-report"}`}>
      <div className={`report-tier-banner ${premium ? "premium" : "base"}`}><span>{premium ? "PREMIUM" : "BASE"}</span><strong>{premium ? "Trading intelligence · annotated structure" : "Market intelligence · concise evidence"}</strong></div>
      <div className="sr-title-row">
        <span className={`sr-pill ${badgeClass}`}>
          {bias} · {String(a.confidence ?? "—")}%
        </span>
        <span className="sr-pill muted-pill">{String(data.tier || data.service)}</span>
      </div>
      <h3 className="sr-headline">{String(a.headline || "")}</h3>
      <p className="sr-summary">{String(a.summary || "")}</p>

      {Boolean(execution.version) && <section className="execution-plan">
        <div className="execution-plan-head">
          <div><span className="eyebrow">REPORT → SPOT</span><h3>{String(recommendation.label || "Conditional trade setup")}</h3><p>{String(recommendation.reason || "Review the trigger, stop and target before opening a wallet transaction.")}</p></div>
          <span className={`decision-chip ${String(recommendation.action || "wait")}`}>{String(recommendation.action || "wait").replaceAll("_", " ")}</span>
        </div>
        <div className="execution-levels">
          <div><span>Observed</span><strong>{String(execution.observedPrice ?? "—")}</strong><small>{pair} · {reportTimeframe}</small></div>
          <div><span>Buy trigger / entry</span><strong>{String(buyPlan.trigger ?? "—")}</strong><small>{String(buyPlan.orderType || "conditional")}</small></div>
          <div><span>Take profit</span><strong>{String(buyPlan.takeProfit ?? "—")}</strong><small>{String((wavePaths[0] as AnyRec)?.label || "primary Elliott path")}</small></div>
          <div><span>Stop loss</span><strong>{String(buyPlan.stopLoss ?? "—")}</strong><small>{buyPlan.riskReward != null ? `R:R ${String(buyPlan.riskReward)}` : "report invalidation"}</small></div>
        </div>
        <div className="execution-copy"><b>How to use it</b><p>PULSE proposes only a new spot buy when the report supports one. Choose how to act below. A bearish or low-confidence report means wait; it never opens a short.</p></div>
        {onTrade && <div className="report-execution-launcher">
          <div className="report-execution-choice" role="group" aria-label="Choose how to use this report">
            <button type="button" className={executionChoice === "market" ? "active" : ""} onClick={() => setExecutionChoice("market")}><b>Market buy</b><span>Fresh quote · buy now</span></button>
            <button type="button" className={executionChoice === "limit" ? "active" : ""} onClick={() => setExecutionChoice("limit")}><b>Limit buy</b><span>Wait for report entry</span></button>
          </div>
          <button className="trade-action buy" type="button" disabled={String(recommendation.action) !== "buy"} onClick={() => onTrade(buyIntent(executionChoice === "limit" ? "limit" : "market"))}><span>{String(recommendation.action) === "buy" ? `Open prefilled ${executionChoice} buy` : "Wait · no valid buy setup"}</span><small>Pair · timeframe · entry · TP · SL stay connected</small></button>
        </div>}
      </section>}

      {premium && Array.isArray(chart.candles) && chart.candles.length > 1 && <TechnicalChart candles={chart.candles as AnyRec[]} technical={technical} analysis={a} />}

      {premium && technical.pivots != null && <>
        <div className="sr-section">Deterministic technical structure</div>
        <div className="technical-grid">
          <div><span>Pivot</span><strong>{String((technical.pivots as AnyRec).pivot ?? "—")}</strong><small>S1 {String((technical.pivots as AnyRec).s1 ?? "—")} · R1 {String((technical.pivots as AnyRec).r1 ?? "—")}</small></div>
          <div><span>Current Elliott phase</span><strong>{String(elliottWave.currentWave ? `Wave ${elliottWave.currentWave}` : ((technical.elliott as AnyRec) || {}).phase || "unclear")}</strong><small>{String(elliottWave.structure || ((technical.elliott as AnyRec) || {}).direction || "candidate count")}</small></div>
          <div><span>Primary wave path</span><strong>{String((wavePaths[0] as AnyRec)?.label || "Recount required")}</strong><small>Target {String((wavePaths[0] as AnyRec)?.target ?? buyPlan.takeProfit ?? "—")}</small></div>
          <div><span>Alternate wave path</span><strong>{String((wavePaths[1] as AnyRec)?.label || "No alternate count")}</strong><small>Target {String((wavePaths[1] as AnyRec)?.target ?? riskExit.downsideReference ?? "—")}</small></div>
          <div><span>Count invalidation</span><strong>{String(elliottWave.invalidation ?? ((technical.elliott as AnyRec) || {}).invalidation ?? "—")}</strong><small>Recount when this level breaks</small></div>
        </div>
        <p className="sr-summary">{String(((technical.elliott as AnyRec) || {}).explanation || "Fibonacci and pivots are deterministically calculated from the attached candle snapshot.")}</p>
      </>}

      {data.defi != null && (() => {
        const defi = data.defi as AnyRec;
        const opportunities = Array.isArray(defi.opportunities) ? defi.opportunities as AnyRec[] : [];
        const requested = String(defi.requestedAsset || defi.asset || "Asset");
        const mapped = String(defi.asset || requested);
        return <><div className="sr-section">DeFi extraction on selected RPC</div><div className="defi-report">
          <strong>{requested}{mapped.toUpperCase() !== requested.toUpperCase() ? ` → ${mapped}` : ""} on {String(defi.network || "network")} · {String(defi.status || "unknown")}</strong>
          <p>{String(defi.explanation || "No verified opportunities available.")}</p>
          {Boolean(defi.tokenAddress) && <code className="defi-token-address">Verified token · {String(defi.tokenAddress)}</code>}
          {opportunities.length > 0 && <div className="defi-opportunities">{opportunities.map((item) => {
            const risks = Array.isArray(item.riskFlags) ? item.riskFlags.map(String) : [];
            return <div key={String(item.investmentId)}><span>{String(item.protocol)} · {String(item.productGroup)} · score {Number(item.score || 0).toFixed(1)}</span><strong>{Number(item.apyPercent).toFixed(2)}% observed APY</strong><small>TVL ${Number(item.tvlUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })} · {Boolean(item.investable) ? "investable" : "not currently investable"} · {Boolean(item.redeemable) ? "redeem supported" : "redeem not confirmed"}</small><small>{risks.join(" · ") || "variable APY · verify before signing"}</small></div>;
          })}</div>}
        </div></>;
      })()}

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

      {wavePaths.length > 0 && (
        <>
          <div className="sr-section">Elliott-wave next paths</div>
          <div className="sr-targets">
            {wavePaths.map((s, i) => (
              <div key={i} className="sr-target">
                <b>{String(s.label || String(s.type || "wave path").replaceAll("_", " "))}</b>
                <strong>tgt {String(s.target ?? "—")}</strong>
                <p>{String(s.thesis || "")}</p>
                {Array.isArray(s.sequence) && <small>{(s.sequence as string[]).join(" → ")}</small>}
              </div>
            ))}
          </div>
        </>
      )}
      {wavePaths.length === 0 && legacyScenarios.length > 0 && (
        <><div className="sr-section">Legacy report paths</div><p className="sr-summary">This recovered report predates Elliott-specific paths. Regenerate it to obtain wave 3, wave 5 and A-B-C count alternatives.</p></>
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

function TechnicalChart({ candles, technical, analysis }: { candles: AnyRec[]; technical: AnyRec; analysis: AnyRec }) {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    if (!zoomed) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setZoomed(false); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [zoomed]);
  const width = 820; const height = 340; const pad = 38; const historyEnd = 590;
  const modelElliott = (analysis.elliottWave as AnyRec) || {};
  const deterministicElliott = (technical.elliott as AnyRec) || {};
  const legacyScenarios = Array.isArray(analysis.scenarios) ? analysis.scenarios as AnyRec[] : [];
  const paths = Array.isArray(modelElliott.paths) && modelElliott.paths.length
    ? modelElliott.paths as AnyRec[]
    : Array.isArray(deterministicElliott.paths) && deterministicElliott.paths.length
      ? deterministicElliott.paths as AnyRec[]
      : legacyScenarios.map((scenario) => ({ type: "recount", label: `${String(scenario.name || "legacy")} legacy path`, target: scenario.target }));
  const pathPrices = paths.map((path) => Number(path.target)).filter(Number.isFinite);
  const invalidation = Number(modelElliott.invalidation ?? (analysis.invalidation as AnyRec)?.price ?? deterministicElliott.invalidation);
  const lows = [...candles.map((c) => Number(c.low)), ...pathPrices, invalidation].filter(Number.isFinite);
  const highs = [...candles.map((c) => Number(c.high)), ...pathPrices, invalidation].filter(Number.isFinite);
  if (!lows.length || !highs.length) return null;
  const rawMin = Math.min(...lows); const rawMax = Math.max(...highs); const margin = (rawMax - rawMin || 1) * .08;
  const min = rawMin - margin; const max = rawMax + margin; const span = max - min || 1;
  const x = (i: number) => pad + i / Math.max(1, candles.length - 1) * (historyEnd - pad);
  const y = (price: number) => pad + (1 - (price - min) / span) * (height - pad * 2);
  const fibs = Array.isArray(technical.fibonacci) ? technical.fibonacci as AnyRec[] : [];
  const waves = Array.isArray(deterministicElliott.waves) ? deterministicElliott.waves as AnyRec[] : [];
  const points = candles.map((c, i) => `${x(i)},${y(Number(c.close))}`).join(" ");
  const lastY = y(Number(candles.at(-1)?.close));
  const colors: Record<string, string> = { wave_3_continuation: "#45e7a6", wave_5_continuation: "#20cfff", abc_correction: "#ffc857", wave_c_continuation: "#ff9d66", count_invalidation: "#ff6f86", recount: "#cbb6ff" };
  const gradientId = `chart-glow-${String(candles[0]?.ts || "report")}`;
  const currentWave = String(modelElliott.currentWave || deterministicElliott.currentWave || "unclear");
  const degree = String(modelElliott.degree || "candidate");
  const chartSvg = <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Premium Elliott chart. Current ${degree} wave ${currentWave}. Projected paths are wave-specific continuation, correction or recount candidates.`}>
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#00e5a0" stopOpacity=".28"/><stop offset="1" stopColor="#00e5a0" stopOpacity="0"/></linearGradient></defs>
    {fibs.map((f) => <g key={String(f.ratio)}><line x1={pad} x2={historyEnd} y1={y(Number(f.price))} y2={y(Number(f.price))} className="fib-line"/><text x={historyEnd-3} y={y(Number(f.price))-3} textAnchor="end" className="chart-label">{String(f.ratio)} · {String(f.price)}</text></g>)}
    <line x1={historyEnd+16} x2={historyEnd+16} y1={pad} y2={height-pad} className="projection-divider"/><text x={historyEnd+25} y={pad+4} className="projection-title">ELLIOTT NEXT PATHS</text>
    <polygon points={`${pad},${height-pad} ${points} ${historyEnd},${height-pad}`} fill={`url(#${gradientId})`}/><polyline points={points} className="price-line"/>
    {waves.map((wave) => { const index = Math.max(0, candles.findIndex((c) => Number(c.ts) === Number(wave.ts))); return <g key={`${String(wave.label)}-${String(wave.ts)}`}><circle cx={x(index)} cy={y(Number(wave.price))} r="8" className="wave-dot"/><text x={x(index)} y={y(Number(wave.price))+3} textAnchor="middle" className="wave-label">{String(wave.label)}</text></g>; })}
    {paths.map((path, index) => { const type = String(path.type || "recount"); const label = String(path.label || type.replaceAll("_", " ")); const target = Number(path.target); if (!Number.isFinite(target)) return null; const targetY = y(target); const targetX = width-pad; const offset = index === 0 ? -10 : index === 1 ? 14 : 28; const color = colors[type] || colors.recount; return <g key={`${type}-${index}`}><path d={`M ${historyEnd} ${lastY} Q ${historyEnd+72} ${(lastY+targetY)/2 + offset} ${targetX} ${targetY}`} fill="none" stroke={color} strokeWidth={index === 0 ? "2.5" : "2"} strokeDasharray={index === 0 ? "0" : "7 5"}/><circle cx={targetX} cy={targetY} r="3" fill={color}/><text x={targetX-3} y={targetY-7} textAnchor="end" fill={color} className="scenario-label">{label.toUpperCase()} · {String(path.target)}</text></g>; })}
    {Number.isFinite(invalidation) && <g><line x1={historyEnd} x2={width-pad} y1={y(invalidation)} y2={y(invalidation)} className="invalidation-line"/><text x={width-pad} y={y(invalidation)-4} textAnchor="end" className="invalidation-label">COUNT INVALIDATION {String(invalidation)}</text></g>}
  </svg>;
  const header = <div className="technical-chart-head"><div><strong>Global Elliott structure and next wave paths</strong><small>Current count · {degree} wave {currentWave}</small></div><span>{String((technical.generatedFrom as AnyRec)?.candleCount || candles.length)} candles · Fib · Pivot · Elliott</span></div>;
  return <>
    <div className="technical-chart" role="button" tabIndex={0} aria-label="Open enlarged Elliott chart" onClick={() => setZoomed(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setZoomed(true); } }}>
      {header}{chartSvg}<span className="chart-zoom-hint">Click to enlarge</span>
    </div>
    {zoomed && typeof document !== "undefined" && createPortal(<div className="chart-zoom-layer" role="dialog" aria-modal="true" aria-label="Enlarged Elliott chart" onClick={() => setZoomed(false)}><div className="chart-zoom-panel"><button type="button" className="chart-zoom-close" onClick={() => setZoomed(false)} aria-label="Close enlarged chart">×</button>{header}{chartSvg}<span className="chart-zoom-hint">Click chart or press Esc to close</span></div></div>, document.body)}
  </>;
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
  const premium = String(data.tier || "").toLowerCase() === "premium";
  const underlying = (data.underlyingSpot as AnyRec) || {};
  const underlyingTechnical = (underlying.technical as AnyRec) || {};
  const underlyingElliott = (underlyingTechnical.elliott as AnyRec) || {};
  const predictionChartAnalysis = {
    elliottWave: {
      degree: "underlying 4H",
      structure: underlyingElliott.direction || "unclear",
      currentWave: underlyingElliott.currentWave || "unclear",
      invalidation: underlyingElliott.invalidation,
      paths: Array.isArray(underlyingElliott.paths) ? underlyingElliott.paths : [],
    },
    invalidation: { price: underlyingElliott.invalidation },
  };

  return (
    <div className={`sr prediction-analysis-report tiered-report ${premium ? "premium-report" : "base-report"}`}>
      <div className={`report-tier-banner ${premium ? "premium" : "base"}`}><span>{premium ? "PREMIUM" : "BASE"}</span><strong>{premium ? "Prediction evidence + independent 4H asset structure" : "Concise prediction evidence"}</strong></div>
      <div className="sr-title-row">
        <span className={`sr-pill ${confidenceClass}`}>{Number.isFinite(confidence) ? `${confidence}% confidence` : "Confidence unavailable"}</span>
        <span className="sr-pill muted-pill">{String(data.tier || "prediction")}</span>
        {Boolean(profile.mode) && <span className="sr-pill muted-pill">{String(profile.mode)} · {String(profile.model || "AI")}</span>}
      </div>
      <h3 className="sr-headline">{String(analysis.headline || "Prediction market analysis")}</h3>
      <p className="sr-summary">{String(analysis.summary || "No narrative summary was returned.")}</p>

      {premium && Array.isArray((underlying.chart as AnyRec)?.candles) && <><div className="sr-section">Underlying asset · 4H</div><p className="sr-summary">{String(underlying.explanation || "")}</p><TechnicalChart candles={(underlying.chart as AnyRec).candles as AnyRec[]} technical={underlyingTechnical} analysis={predictionChartAnalysis} /></>}
      {premium && underlying.status === "unmapped" && <div className="defi-report"><strong>4H asset chart unavailable</strong><p>{String(underlying.explanation)}</p></div>}

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

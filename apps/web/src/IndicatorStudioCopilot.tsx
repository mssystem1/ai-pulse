import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseIndicatorGraph, type IndicatorGraphDefinition } from "@pulse/domain";
import { terminalRequest } from "./terminalClient";

type Draft = { graph: IndicatorGraphDefinition; title: string; description: string; explanation: string; previewRequired: true; model?: string };
type Props = { token: string; active: boolean; graph: IndicatorGraphDefinition; onApply: (graph: IndicatorGraphDefinition, title?: string, description?: string) => void; lang?: "en" | "zh" };

const suggestions = [
  "Build a 20-period EMA overlay on close",
  "Create a 14-period RSI oscillator",
  "Show a bullish crossover when EMA 20 crosses above EMA 50",
];

export function IndicatorStudioCopilot({ token, active, graph, onApply, lang = "en" }: Props) {
  const zh = lang === "zh", [mode, setMode] = useState<"create" | "edit">("create"), [prompt, setPrompt] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [draft, setDraft] = useState<Draft | null>(null), [notice, setNotice] = useState("");
  const requestId = useRef(0), controller = useRef<AbortController | null>(null);

  function cancelRequest() {
    requestId.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
  }
  useEffect(() => {
    if (!active || !token) { requestId.current++; controller.current?.abort(); controller.current = null; setBusy(false); }
  }, [token, active]);
  useEffect(() => {
    requestId.current++; controller.current?.abort(); controller.current = null;
    setBusy(false); setDraft(null);
  }, [graph]);
  useEffect(() => () => { requestId.current++; controller.current?.abort(); controller.current = null; }, []);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !token || busy || prompt.trim().length < 3) return;
    controller.current?.abort();
    const id = ++requestId.current, nextController = new AbortController();
    controller.current = nextController;
    setBusy(true); setError(""); setNotice(""); setDraft(null);
    try {
      const result = await terminalRequest<Draft>("indicator-assist", {
        token, method: "POST", signal: nextController.signal,
        body: { prompt: prompt.trim(), mode, ...(mode === "edit" ? { currentGraph: parseIndicatorGraph(graph) } : {}) },
        timeoutMs: 45_000,
      });
      if (requestId.current !== id) return;
      const validated = parseIndicatorGraph(result.graph);
      if (result.previewRequired !== true || typeof result.title !== "string" || typeof result.description !== "string" || typeof result.explanation !== "string") throw new Error(zh ? "AI 返回的草稿不完整，尚未应用。" : "The assistant returned an incomplete draft. Nothing was applied.");
      setDraft({ ...result, graph: validated });
    } catch (cause) {
      if (requestId.current !== id || nextController.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : (zh ? "无法生成指标草稿。" : "Could not generate an indicator draft."));
    } finally {
      if (requestId.current === id) { controller.current = null; setBusy(false); }
    }
  }

  function applyDraft() {
    if (!draft) return;
    onApply(parseIndicatorGraph(draft.graph), draft.title, draft.description);
    setNotice(zh ? "草稿已放入 Studio。请检查图表预览；发布仍需单独操作。" : "Draft added to Studio. Review its chart preview; publishing remains a separate action.");
    setDraft(null);
  }

  const text = zh ? {
    title: "Studio AI 助手", intro: "描述你想研究的指标。助手会生成受限的图结构；先检查草稿和本地预览，再决定是否应用。",
    create: "新建指标", edit: "修改当前图", request: "描述指标", placeholder: "例如：收盘价的 20 周期 EMA，并显示在价格图上", use: "生成草稿", busy: "正在生成…", cancel: "取消生成",
    tips: "建议", output: "草稿预览", nodes: "计算节点", plots: "绘图", apply: "使用此草稿", draftOnly: "草稿尚未应用或发布。指标图只使用 PULSE 支持的因果数据源和计算。",
  } : {
    title: "Studio AI copilot", intro: "Describe the study you want. The copilot returns a bounded graph draft; inspect it and the local chart preview before choosing whether to apply it.",
    create: "Create indicator", edit: "Edit current graph", request: "Describe the indicator", placeholder: "For example: a 20-period EMA of close overlaid on price", use: "Generate draft", busy: "Generating…", cancel: "Cancel generation",
    tips: "Try one of these", output: "Draft preview", nodes: "Calculation nodes", plots: "Plots", apply: "Use this draft", draftOnly: "This draft has not been applied or published. Graphs use only PULSE-supported causal sources and calculations.",
  };

  return <section className="terminal-panel indicator-copilot" aria-labelledby="indicator-copilot-title">
    <div className="terminal-section-heading"><div><span className="terminal-eyebrow">{zh ? "受限图结构 · 本地预览" : "Bounded graph · local preview"}</span><h4 id="indicator-copilot-title">{text.title}</h4></div></div>
    <p className="terminal-hint">{text.intro}</p>
    <div className="indicator-builder-tabs" role="group" aria-label={zh ? "助手模式" : "Copilot mode"}>
      <button type="button" aria-pressed={mode === "create"} disabled={busy} onClick={() => { setMode("create"); setDraft(null); setNotice(""); }}>{text.create}</button>
      <button type="button" aria-pressed={mode === "edit"} disabled={busy} onClick={() => { setMode("edit"); setDraft(null); setNotice(""); }}>{text.edit}</button>
    </div>
    <div aria-label={text.tips}>
      <small className="terminal-eyebrow">{text.tips}</small>
      <div className="terminal-actions">{suggestions.map(suggestion => <button type="button" key={suggestion} disabled={busy} onClick={() => setPrompt(suggestion)}>{suggestion}</button>)}</div>
    </div>
    <form className="terminal-form" onSubmit={generate}>
      <label htmlFor="indicator-copilot-prompt">{text.request}</label>
      <textarea id="indicator-copilot-prompt" rows={3} maxLength={1000} minLength={3} required value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={text.placeholder} disabled={busy} />
      <div className="terminal-actions">
        <button type="submit" className="terminal-primary" disabled={!active || !token || busy || prompt.trim().length < 3}>{busy ? text.busy : text.use}</button>
        {busy && <button type="button" onClick={cancelRequest}>{text.cancel}</button>}
      </div>
    </form>
    {error && <p role="alert" className="terminal-warning">{error}</p>}
    {notice && <p role="status" className="terminal-hint">{notice}</p>}
    {draft && <article className="terminal-evidence" aria-live="polite">
      <span className="terminal-eyebrow">{text.output}</span><h5>{draft.title}</h5><p>{draft.description}</p><p>{draft.explanation}</p>
      <dl><div><dt>{text.nodes}</dt><dd>{draft.graph.nodes.length}</dd></div><div><dt>{text.plots}</dt><dd>{draft.graph.plots.map(plot => `${plot.label} (${plot.pane}, ${plot.unit})`).join(" · ")}</dd></div></dl>
      <p className="terminal-hint">{text.draftOnly}</p>
      <button type="button" className="terminal-primary" onClick={applyDraft}>{text.apply}</button>
    </article>}
  </section>;
}

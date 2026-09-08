import { useEffect, useRef, useState } from "react";
import type { WebNetworkKey } from "./networks";
import "./appearance.css";

export const APPEARANCES = [
  { id: "xlayer", name: "Neon Pulse", zh: "霓虹脉冲", detail: "Midnight · mint", detailZh: "午夜黑 · 薄荷绿", color: "#00d7ab" },
  { id: "base", name: "Daybreak", zh: "破晓", detail: "Light · cobalt", detailZh: "明亮白 · 钴蓝", color: "#0052ff" },
  { id: "arbitrum", name: "Deep Current", zh: "深海洋流", detail: "Navy · ice blue", detailZh: "深海蓝 · 冰蓝", color: "#28a0f0" },
  { id: "arc-testnet", name: "Silver Orbit", zh: "银色轨道", detail: "Slate · silver", detailZh: "石板灰 · 银色", color: "#adcfd8" },
] as const;

export function AppearancePicker({ value, onChange, lang }: { value: WebNetworkKey; onChange: (value: WebNetworkKey) => void; lang: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const current = APPEARANCES.find((item) => item.id === value)!;
  return <div ref={root} className="appearance-picker">
    <button ref={trigger} type="button" className="appearance-trigger" aria-label={lang === "zh" ? "选择外观" : "Choose appearance"} title={lang === "zh" ? "选择外观" : "Choose appearance"} aria-expanded={open} aria-controls="appearance-options" onClick={() => setOpen(!open)}>
      <i style={{ background: current.color }} aria-hidden /> <span>{lang === "zh" ? "外观" : "Appearance"}</span><b aria-hidden>⌄</b>
    </button>
    {open && <section id="appearance-options" className="appearance-menu" aria-label={lang === "zh" ? "选择外观" : "Choose appearance"}>
      <strong>{lang === "zh" ? "你的 PULSE，你的风格" : "Your PULSE. Your style."}</strong>
      <p>{lang === "zh" ? "只更改外观，不切换网络或钱包。" : "Changes the look, never your network or wallet."}</p>
      {APPEARANCES.map((item) => <button type="button" key={item.id} aria-pressed={value === item.id} onClick={() => { onChange(item.id); setOpen(false); trigger.current?.focus(); }}>
        <i style={{ background: item.color }} aria-hidden /><span><b>{lang === "zh" ? item.zh : item.name}</b><small>{lang === "zh" ? item.detailZh : item.detail}</small></span><span aria-hidden>{value === item.id ? "✓" : ""}</span>
      </button>)}
    </section>}
  </div>;
}

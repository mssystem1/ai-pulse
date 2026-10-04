import { presentResearch, researchChartSvg, researchText, type ResearchContext } from "@pulse/domain";
import { useEffect, useState } from "react";

export function TelegramResearchReport({report,context}:{report:unknown;context?:ResearchContext}) {
  const presentation=presentResearch(report,context),chart=researchChartSvg(report,context);
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{if(!expanded)return;const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setExpanded(false);};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[expanded]);
  const image=chart?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(chart)}`:undefined;
  const download=()=>{
    const url=URL.createObjectURL(new Blob([researchText(presentation)],{type:"text/plain;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download=`PULSE-${presentation.label.replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,120)}.txt`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <article className="tg-research-report">
    <header className="tg-research-heading"><span className="tg-kicker">{presentation.serviceTitle}</span><h2>{presentation.subject}{presentation.timeframe&&<span> · {presentation.timeframe}</span>}</h2>{presentation.generatedAt&&<p className="tg-fine">{presentation.generatedAt}</p>}<h3>{presentation.headline}</h3><p>{presentation.summary}</p><button className="tg-inline-button" onClick={download}>Download research TXT</button></header>
    {image&&<figure className="tg-research-chart"><button className="tg-chart-expand" onClick={()=>setExpanded(true)} aria-label="Enlarge report chart"><img src={image} alt={`${presentation.subject} ${presentation.timeframe||"4H underlying asset"} original report chart with conditional Elliott paths`}/></button><figcaption>Original report snapshot · conditional scenarios · tap to enlarge</figcaption></figure>}
    {expanded&&image&&<div className="tg-chart-dialog" role="dialog" aria-modal="true" aria-label="Enlarged report chart"><button className="tg-button tg-button-secondary" autoFocus onClick={()=>setExpanded(false)}>Close chart</button><div className="tg-chart-scroll"><img src={image} alt="Enlarged original report chart with conditional paths"/></div><p>Swipe across the chart to read the saved levels and scenario legend.</p></div>}
    {presentation.sections.map(section=><section className="tg-research-section" key={section.title}><h3>{section.title}</h3><ul>{section.lines.map((line,index)=><li key={index}>{line}</li>)}</ul></section>)}
    <footer className="tg-research-disclaimer"><h3>Disclaimer</h3><p>{presentation.disclaimer}</p></footer>
  </article>;
}

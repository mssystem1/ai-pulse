import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {readGlobalReport} from "@pulse/domain";
import {GlobalMarketChart} from "../../apps/web/src/GlobalMarketChart";
import "../../apps/web/src/globalReport.css";

function Harness(){
  const [ticks,setTicks]=useState(0),[zh,setZh]=useState(false);
  useEffect(()=>{const timer=setInterval(()=>setTicks(n=>n+1),300);return()=>clearInterval(timer);},[]);
  // The application validates saved reports on parent updates. Zod returns
  // equivalent new objects; chart gestures must survive those refreshes.
  const report=readGlobalReport((window as any).__viewportReport)!;
  report.lang=zh?"zh":"en";
  return <main style={{background:"#0d1420",color:"#cbd7e6",padding:12}}><button data-qa-language onClick={()=>setZh(v=>!v)}>Language</button><output data-qa-refreshes>{ticks}</output><GlobalMarketChart report={report} selectedPathId={null}/></main>;
}
createRoot(document.getElementById("root")!).render(<Harness/>);

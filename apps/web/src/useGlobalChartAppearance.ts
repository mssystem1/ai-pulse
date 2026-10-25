import {useEffect,useState} from "react";
import type {GlobalChartAppearance} from "./globalChartTheme";
export function useGlobalChartAppearance():GlobalChartAppearance{
  const read=():GlobalChartAppearance=>typeof document!=="undefined"&&document.documentElement.dataset.pulseTheme==="base"?"light":"dark";
  const [appearance,setAppearance]=useState(read);
  useEffect(()=>{const observer=new MutationObserver(()=>setAppearance(read()));observer.observe(document.documentElement,{attributes:true,attributeFilter:["data-pulse-theme"]});return ()=>observer.disconnect();},[]);
  return appearance;
}

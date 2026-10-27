import {Resvg} from "@resvg/resvg-js";
import {fileURLToPath} from "node:url";
import {globalChartRasterSize} from "@pulse/domain";
export function renderResearchPng(svg:string,highResolution=true):Uint8Array{
  const root=svg.match(/<svg\b[^>]*>/)?.[0]??"";
  const width=Number(root.match(/\bwidth="([\d.]+)"/)?.[1]),height=Number(root.match(/\bheight="([\d.]+)"/)?.[1]);
  const size=highResolution?globalChartRasterSize(width,height):{width,height};
  return new Resvg(svg,{fitTo:{mode:"width",value:size.width},font:{fontFiles:[fileURLToPath(new URL("../../../assets/fonts/Inter.ttf",import.meta.url)),fileURLToPath(new URL("../../../assets/fonts/NotoSansSC-Regular.otf",import.meta.url))],loadSystemFonts:false,defaultFontFamily:"Inter"}}).render().asPng();
}

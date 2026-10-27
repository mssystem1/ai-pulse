/** Shared paint and raster limits for browser, mobile and server exports. */
export type GlobalChartAppearance="light"|"dark";
const surfaces=new Set(["#0d1420","#0f1826","#111c2c","#121f30","#142034","#152033","#181c24","#202036","#24364b","#101c2c","#101e2c","#111e2b"]);
const channels=(hex:string)=>[0,2,4].map(i=>parseInt(hex.slice(i+1,i+3),16));
function luminance(rgb:number[]){return rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);}
export function globalChartColor(color:string,appearance:GlobalChartAppearance,role:"text"|"stroke"|"fill"="stroke"):string{
  if(appearance==="dark"||!/^#[a-f\d]{6}([a-f\d]{2})?$/i.test(color))return color;
  const base=color.slice(0,7).toLowerCase(),alpha=color.slice(7);
  if(role==="fill"&&surfaces.has(base))return (base==="#0d1420"?"#f8fbff":"#eaf0f8")+alpha;
  let rgb=channels(base);
  if(role==="fill"&&luminance(rgb)<.065)return "#eaf0f8"+alpha;
  if(role!=="text"&&luminance(rgb)<.065)return "#a7b6ca"+alpha;
  const required=role==="text"?9:3.5;
  while(1.05/(luminance(rgb)+.05)<required)rgb=rgb.map(v=>Math.floor(v*.94));
  return '#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('')+alpha;
}
export function themeGlobalChartSvg(svg:string,appearance:GlobalChartAppearance):string{
  if(appearance==="dark")return svg;
  return svg.replace(/<[^>]+>/g,tag=>tag.replace(/\b(fill|stroke)="(#[a-f\d]{6}(?:[a-f\d]{2})?)"/gi,(_whole,attr,color)=>`${attr}="${globalChartColor(color,appearance,tag.startsWith('<text')?'text':attr==='fill'?'fill':'stroke')}"`));
}
/** High resolution without unbounded canvas dimensions on mobile devices. */
export function globalChartRasterSize(width:number,height:number){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error("Invalid chart dimensions");
  const maxPixels=16_000_000,maxSide=8192;
  let outputWidth=Math.max(1,Math.floor(Math.min(3900,maxSide,maxSide*width/height,10_000*width/(width+height),Math.sqrt(maxPixels*width/height))));
  let outputHeight=Math.ceil(outputWidth*height/width);
  while(outputWidth*outputHeight>maxPixels&&outputWidth>1){outputWidth--;outputHeight=Math.ceil(outputWidth*height/width);}
  return {width:outputWidth,height:outputHeight};
}

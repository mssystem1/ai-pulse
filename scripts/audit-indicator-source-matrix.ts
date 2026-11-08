import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {indicatorMarketCatalog,indicatorStudyTemplates,createStudyIndicatorPackage,evaluateIndicator} from "../packages/domain/src/indicatorMarket.js";
import {indicatorInputFromMarket} from "../apps/web/src/terminalIndicatorClient.js";
export async function auditIndicatorSourceMatrix(request:(path:string)=>Promise<any>,record:(name:string,details:Record<string,unknown>)=>void){
 const folder=".tmp/indicator-source-matrix";await mkdir(folder,{recursive:true});
 const manifests=[...indicatorMarketCatalog(),...indicatorStudyTemplates().map(template=>createStudyIndicatorPackage({...template,id:"qa.matrix."+template.id,author:"PULSE QA"}))];
 const results=[];let covered=0;
 for(const [instId,timeframe] of [["BTC-USDT","15m"],["BTC-USDT","1H"],["BTC-USDT","4H"],["BTC-USDT","1Dutc"],["BTC-USDT","1Wutc"],["ETH-USDT","1Dutc"]]){
  const market=await request(`/v1/terminal/market?instId=${instId}&timeframe=${timeframe}`);
  await writeFile(`${folder}/${instId}-${timeframe}.json`,JSON.stringify(market));
  for(const stream of ["spot","perpetual"] as const){
   const input=indicatorInputFromMarket(market,stream),row={instId,timeframe,stream,source:input.source,points:input.points.length,status:input.status,studies:[] as unknown[]};
   for(const manifest of manifests){const result=evaluateIndicator(manifest,input);row.studies.push({id:manifest.id,status:result.status,points:result.points.length,resolved:result.points.filter(p=>p.value!==undefined||p.cvd!==undefined||p.participationBps!==undefined).length});}
   if(input.points.length){covered++;assert(row.studies.length===9);}results.push(row);record("indicator_live_source_matrix",row);
  }
 }
 assert(covered>0,"No live executed-volume source was available; do not claim live indicator acceptance");
 await writeFile(`${folder}/validation.json`,JSON.stringify({at:new Date().toISOString(),covered,results},null,2));
}

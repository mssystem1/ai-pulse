import test from "node:test";
import assert from "node:assert/strict";
import {globalChartColor,themeGlobalChartSvg} from "./globalChartTheme";
test("Clarity paints chart surfaces and text without changing its price ledger or source times",()=>{
  const svg='<svg><rect fill="#0d1420"/><g data-price="80729.9607498" data-known-at="1792908000000"><text fill="#ffcb76">Entry 80,729.96</text><path fill="none" stroke="#53dabb"/></g></svg>';
  const light=themeGlobalChartSvg(svg,"light");assert.match(light,/fill="#f8fbff"/);assert.doesNotMatch(light,/#ffcb76|#0d1420/);
  assert.equal(light.replace(/\b(fill|stroke)="[^"]*"/g,''),svg.replace(/\b(fill|stroke)="[^"]*"/g,''));assert.equal(themeGlobalChartSvg(svg,"dark"),svg);
});
test("chart text has at least 7:1 contrast against the Clarity panel",()=>{
  const lum=(hex:string)=>[0,2,4].map(i=>parseInt(hex.slice(i+1,i+3),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  for(const c of ['#b9c6d8','#ffcb76','#53dabb','#f0738c','#99abc4','#e7eef8','#b58aff']){
    const converted=globalChartColor(c,"light","text");assert.ok((lum('#eaf0f8')+.05)/(lum(converted)+.05)>=7,c);
  }
});

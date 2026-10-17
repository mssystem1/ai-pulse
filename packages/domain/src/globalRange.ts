import type {GlobalReport} from "@pulse/schemas";

export function globalRangeSummary(report:GlobalReport):string|null{
  const r=report.range;if(!r)return null;
  const price=(p:number)=>p.toLocaleString(report.lang==="zh"?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision,minimumFractionDigits:Math.min(2,report.snapshot.pricePrecision)}),zone=(values:[number,number])=>values.map(price).join("–");
  return report.lang==="zh"?`区间 ${price(r.lower[0])}–${price(r.upper[1])}；支撑区域 ${zone(r.lower)}，阻力区域 ${zone(r.upper)}。`:`Range ${price(r.lower[0])}–${price(r.upper[1])}; support zone ${zone(r.lower)}, resistance zone ${zone(r.upper)}.`;
}

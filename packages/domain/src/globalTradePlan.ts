import { candleTimeframeMs, type GlobalReport } from "@pulse/schemas";
import { globalConfirmationEvidence } from "./globalConfirmation.js";

/** A conditional plan from the saved map, independent of Elliott labels and
 * execution quotes. Its reference prices must never be copied as observed SL. */
export function deriveGlobalTradePlan(report: GlobalReport): NonNullable<GlobalReport["tradePlan"]> {
  const empty: NonNullable<GlobalReport["tradePlan"]> = {side:"none",pathId:null,state:"none",condition:"close_retest",triggerLevelId:null,invalidationLevelId:null,targetIds:[],referenceEntry:null,referenceStop:null,grossRewardRisk:null,stopBufferAtr:.2,confirmationTs:null,retestTs:null,blockers:[]};
  const path = report.paths.find(p => p.role === "main" && report.view.pathIds.includes(p.id));
  const last = report.candles.at(-1), atr = report.indicators.atr.points.at(-1)?.value;
  if (!last || !atr) return {...empty,blockers:["history"]};
  if (!path) return {...empty,blockers:["levels"]};
  const level = (id: string | null | undefined) => report.levels.find(l => l.id === id);
  let trigger = level(path.triggerLevelId), invalidation = level(path.invalidationLevelId), targets = path.targetIds.flatMap(id => level(id) ?? []);
  let side: "long" | "short" = path.direction === "down" ? "short" : "long";
  let condition: NonNullable<GlobalReport["tradePlan"]>["condition"] = path.confirmation === "support_hold" ? "support_hold" : path.confirmation === "hold" ? "rejection" : "close_retest";
  if (path.direction === "range" && trigger && targets[0]) {
    const floor = trigger, ceiling = targets[0];
    side = last.close - floor.price <= ceiling.price - last.close ? "long" : "short";
    trigger = side === "long" ? floor : ceiling; targets = [side === "long" ? ceiling : floor];
    invalidation = report.levels.filter(l => side === "long" ? l.price < floor.price : l.price > ceiling.price).sort((a,b) => side === "long" ? b.price-a.price : a.price-b.price)[0];
    condition = side === "long" ? "support_hold" : "rejection";
  }
  if (!trigger || !invalidation || !targets.length) return {...empty,blockers:["levels"]};
  const round = (n: number) => Number(n.toPrecision(12)), sign = side === "long" ? 1 : -1;
  const distance=sign*(targets[0].price-trigger.price);
  if(distance<=0)return {...empty,blockers:["levels"]};
  const allowance=Math.min(atr*.05,distance*.25);
  // A small, explicitly planned allowance around the mapped trigger; stop is
  // outside structural invalidation plus a measured ATR buffer, not a retest SL.
  const referenceEntry: [number,number] = side === "long" ? [trigger.price,round(trigger.price + allowance)] : [round(trigger.price - allowance),trigger.price];
  const referenceStop = round(invalidation.price - sign * atr * .2), worstEntry = side === "long" ? referenceEntry[1] : referenceEntry[0];
  if (referenceStop <= 0 || sign * (worstEntry-referenceStop) <= 0 || targets.some(l=>sign*(l.price-worstEntry)<=0)) return {...empty,blockers:["levels"]};
  const grossRewardRisk = round(sign * (targets[0].price - worstEntry) / (sign * (worstEntry-referenceStop)));
  const blockers: NonNullable<GlobalReport["tradePlan"]>["blockers"] = [];
  const evidence = globalConfirmationEvidence(report,{side,condition,triggerLevelId:trigger.id,invalidationLevelId:invalidation.id,referenceStop});
  const {confirmation,retest} = evidence;
  if (!confirmation) blockers.push("confirmation");
  if (!retest) blockers.push("retest");
  if (grossRewardRisk < 1.5) blockers.push("reward");
  const invalid = sign * (last.close - invalidation.price) < 0;
  if (invalid || evidence.failure) blockers.push("cancelled");
  if (evidence.expired) blockers.push("expired");
  if (last.close < referenceEntry[0] || last.close > referenceEntry[1]) blockers.push("entry_price");
  return {side,pathId:path.id,state:blockers.includes("reward") || blockers.includes("cancelled") || blockers.includes("expired") ? "avoid" : blockers.length ? "conditional" : "confirmed",condition,triggerLevelId:trigger.id,invalidationLevelId:invalidation.id,targetIds:targets.map(l=>l.id),referenceEntry,referenceStop,grossRewardRisk,stopBufferAtr:.2,confirmationTs:confirmation?.ts ?? null,retestTs:retest?.ts ?? null,blockers};
}

export function globalTradePlan(report: GlobalReport) {
  const saved=report.tradePlan;
  if (!saved) return deriveGlobalTradePlan(report);
  if (saved.side === "none" || !saved.triggerLevelId || !saved.invalidationLevelId) return saved;
  // Preserve purchased prices. Correct only unsafe confirmation claims from
  // older evaluators, using the same immutable saved completed candles.
  const evidence=globalConfirmationEvidence(report,{...saved,side:saved.side,triggerLevelId:saved.triggerLevelId,invalidationLevelId:saved.invalidationLevelId});
  if (!evidence.failure && !evidence.expired && (!saved.confirmationTs || evidence.confirmation?.ts===saved.confirmationTs) && (!saved.retestTs || evidence.retest?.ts===saved.retestTs)) return saved;
  const blockers=saved.blockers.filter(key=>!["confirmation","retest","expired","cancelled"].includes(key));
  if(!evidence.confirmation)blockers.push("confirmation");if(!evidence.retest)blockers.push("retest");
  const oldCandle=report.candles.find(c=>c.ts===saved.confirmationTs),boundary=report.levels.find(l=>l.id===saved.invalidationLevelId)?.price,trigger=report.levels.find(l=>l.id===saved.triggerLevelId)?.price;
  const sign=saved.side==="long"?1:-1,interval=candleTimeframeMs(report.snapshot.timeframe);
  const validOldBoundary=oldCandle&&boundary!==undefined&&trigger!==undefined&&(sign*(trigger-boundary)>0?(saved.side==="long"?oldCandle.low>boundary:oldCandle.high<boundary):sign*(oldCandle.close-boundary)>=0);
  const expiredSaved=!evidence.confirmation&&validOldBoundary&&interval>0&&saved.confirmationTs!==null&&Date.parse(report.snapshot.observedAt)>=saved.confirmationTs+4*interval;
  if(evidence.failure||saved.confirmationTs&&!evidence.confirmation&&!expiredSaved)blockers.push("cancelled");
  if(evidence.expired||expiredSaved)blockers.push("expired");
  return {...saved,state:blockers.some(key=>["cancelled","expired","reward"].includes(key))?"avoid" as const:"conditional" as const,confirmationTs:evidence.confirmation?.ts??null,retestTs:evidence.retest?.ts??null,blockers};
}

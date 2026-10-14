import { candleTimeframeMs, candleCloseTime, type GlobalReport, type GlobalCandle } from "@pulse/schemas";

/** Shared completed-candle evidence for a mapped attempt. A failed candle
 * cannot also start its replacement; a fresh confirmation needs a later bar. */
export function globalConfirmationEvidence(report: GlobalReport, input: {
  side: "long" | "short";
  condition: "close_retest" | "support_hold" | "rejection";
  triggerLevelId: string;
  invalidationLevelId: string;
  referenceStop?: number | null;
}) {
  const trigger = report.levels.find(l => l.id === input.triggerLevelId);
  const floor = report.levels.find(l => l.id === input.invalidationLevelId);
  const anchor = report.indicators.pivots.find(a => trigger?.anchorIds.includes(a.id));
  let confirmation: GlobalCandle | undefined, retest: GlobalCandle | undefined;
  let failedConfirmation: GlobalCandle | undefined, failure: GlobalCandle | undefined;
  let failedRetest: GlobalCandle | undefined;
  let failureReason: "floor" | "trigger" | "stop" | undefined;
  const interval = candleTimeframeMs(report.snapshot.timeframe);
  if (trigger && floor && anchor?.confirmedAt != null) {
    const sign = input.side === "long" ? 1 : -1;
    for (const c of report.candles.slice(-8).filter(c => c.ts > anchor.confirmedAt!)) {
      const previous = report.candles[report.candles.indexOf(c) - 1];
      // When trigger and invalidation coincide (a resistance rejection), the
      // test must touch that line; only its failed close invalidates it.
      const distinctFloor = sign * (trigger.price - floor.price) > 0;
      const floorBroken = distinctFloor ? input.side === "long" ? c.low <= floor.price : c.high >= floor.price : sign * (c.close-floor.price) < 0;
      const stopBroken = input.referenceStop != null && (input.side === "long" ? c.low <= input.referenceStop : c.high >= input.referenceStop);
      const triggerFailed = sign * (c.close - trigger.price) < 0;
      if (confirmation && (floorBroken || stopBroken || triggerFailed)) {
        failedConfirmation = confirmation; failedRetest = retest; failure = c;
        failureReason = floorBroken&&distinctFloor ? "floor" : triggerFailed ? "trigger" : "stop";
        confirmation = undefined; retest = undefined;
        continue;
      }
      if (floorBroken || stopBroken) continue;
      const testHolds = input.side === "long" ? c.low <= trigger.price && c.close >= trigger.price : c.high >= trigger.price && c.close <= trigger.price;
      const starts = input.condition === "close_retest"
        ? previous && sign * (previous.close - trigger.price) <= 0 && sign * (c.close - trigger.price) > 0
        : testHolds;
      if (starts && (!confirmation || interval>0&&c.ts>=confirmation.ts+interval*4)) {
        confirmation = c; retest = undefined; failure = undefined; failedConfirmation = undefined; failedRetest = undefined; failureReason = undefined;
      } else if (confirmation && c.ts > confirmation.ts && testHolds) retest ??= c;
    }
  }
  const expiresAt = confirmation && interval > 0 ? confirmation.ts + interval * 4 : null;
  const expired = expiresAt !== null && Date.parse(report.snapshot.observedAt) >= expiresAt;
  return { confirmation, retest, failedConfirmation, failedRetest, failure, failureReason, expiresAt, expired };
}

/** Historical event evidence for narrative grounding. It never restores the
 * inactive setup's entry/SL or authorizes an order. */
export function globalSetupAttemptEvidence(report: GlobalReport) {
  const s=report.setup,path=report.paths.find(p=>p.id===s.pathId);
  if(!path||!s.triggerLevelId||!s.invalidationLevelId)return null;
  const e=globalConfirmationEvidence(report,{side:"long",condition:path.confirmation==="support_hold"?"support_hold":"close_retest",triggerLevelId:s.triggerLevelId,invalidationLevelId:s.invalidationLevelId});
  const retest=e.failedRetest??e.retest;
  return {kind:"spot_buy_attempt",state:s.state,confirmationTs:e.failedConfirmation?.ts??e.confirmation?.ts??s.confirmationTs,
    retestTs:retest?.ts??s.retestTs,retestObservedBeforeFailure:!!e.failedRetest,
    failure:e.failure?{reason:e.failureReason,candleTs:e.failure.ts,completedAt:candleCloseTime(e.failure.ts,report.snapshot.timeframe),low:e.failure.low,high:e.failure.high,close:e.failure.close,
      triggerPrice:report.levels.find(l=>l.id===s.triggerLevelId)?.price,invalidationPrice:report.levels.find(l=>l.id===s.invalidationLevelId)?.price}:null,
    activeObservedProtection:s.state!=="cancelled"&&s.state!=="expired"&&s.entryZone!==null&&s.protectiveStop!==null};
}

export function globalPrimaryAttemptEvidence(report:GlobalReport) {
  const p=report.tradePlan;
  if(!p||p.side==="none"||!p.triggerLevelId||!p.invalidationLevelId)return null;
  const e=globalConfirmationEvidence(report,{side:p.side,condition:p.condition,triggerLevelId:p.triggerLevelId,invalidationLevelId:p.invalidationLevelId,referenceStop:p.referenceStop});
  return {kind:"directional_research_plan",side:p.side,state:p.state,confirmationTs:e.failedConfirmation?.ts??e.confirmation?.ts??p.confirmationTs,
    retestTs:e.failedRetest?.ts??e.retest?.ts??p.retestTs,retestObservedBeforeFailure:!!e.failedRetest,
    failure:e.failure?{reason:e.failureReason,candleTs:e.failure.ts,completedAt:candleCloseTime(e.failure.ts,report.snapshot.timeframe),low:e.failure.low,high:e.failure.high,close:e.failure.close,
      triggerPrice:report.levels.find(l=>l.id===p.triggerLevelId)?.price,invalidationPrice:report.levels.find(l=>l.id===p.invalidationLevelId)?.price}:null,
    activeObservedProtection:false};
}

import {deriveGlobalEntryPlan} from "@pulse/domain";
import {strategyFixture} from "./globalStrategy.fixtures.js";

export function tradePlanFixture(frame="4H",side:"long"|"short"="long",family:"breakout_retest"|"reaction"="breakout_retest",now=Date.parse("2026-10-19T00:00:00Z")){
  const fixture=strategyFixture(frame,side,family,now),r=fixture.report;
  r.decisionVersion="decision-v5";r.strategy!.version="horizon-v2";r.strategy!.minimumObjectiveAtr=0;
  r.tradePlan=deriveGlobalEntryPlan(r);return fixture;
}

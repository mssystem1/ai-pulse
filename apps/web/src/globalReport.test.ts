import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { globalDesignFixture } from "../../../packages/domain/dist/globalReport.fixtures.js";
import { GlobalResearchReport } from "./GlobalResearchReport";
import { TelegramResearchReport } from "./TelegramResearchReport";
import { AnalysisReport } from "./Report";
import { buildReportBuyIntent, buildReportManualBuyIntent, buildReportSellIntent, buildTelegramReportBuyIntent } from "./reportTradeHandoff";

test("web and Telegram Mini App render the same aligned Spot plan for both tiers",()=>{for(const tier of ["quick","pro"] as const){const report=globalDesignFixture(tier);for(const html of [renderToStaticMarkup(createElement(GlobalResearchReport,{report})),renderToStaticMarkup(createElement(TelegramResearchReport,{report})),renderToStaticMarkup(createElement(AnalysisReport,{data:{global:report},nfa:"Research"}))]){assert.match(html,/data-global-version="pulse-global-v3"/);assert.match(html,/data-setup-state="watching"/);assert.match(html,/117.3/);assert.match(html,/120.56/);assert.match(html,/124.8/);assert.match(html,/113.12/);assert.match(html,/Pending the observed retest/);assert.ok(html.indexOf("global-spot-card")>html.indexOf("global-chart-stage"));assert.equal(html.includes("Regression 120"),tier==="pro");assert.equal(html.includes("Confirmed pivots"),tier==="pro");assert.ok(!html.includes("Manual trade selected"));}}});
test("inactive canonical reports cannot preload Market or Limit orders",()=>{for(const state of ["watching","cancelled","expired","none"] as const){const report=globalDesignFixture();report.setup.state=state;for(const orderType of ["market","limit"] as const)assert.throws(()=>buildReportBuyIntent({global:report},orderType),/not ready/);}});
test("Chinese reports localize setup state and confirmation/cancellation rules",()=>{const html=renderToStaticMarkup(createElement(GlobalResearchReport,{report:globalDesignFixture("pro","zh")}));assert.match(html,/观察中/);assert.match(html,/取消/);assert.match(html,/等待实际回测/);assert.match(html,/费用后收益风险比/);});
test("a single supported target does not advertise an unplotted S3 stage",()=>{const report=globalDesignFixture();report.paths.find(path=>path.id===report.setup.pathId)!.targetIds=["target1"];report.setup.targetIds=["target1"];for(const Component of [GlobalResearchReport,TelegramResearchReport]){const html=renderToStaticMarkup(createElement(Component,{report}));assert.match(html,/S1 → S2/);assert.doesNotMatch(html,/S3|TARGET 2/);}});

function readyFixture(tier: "quick" | "pro" = "pro") {
  const report=globalDesignFixture(tier);
  report.snapshot.price=117.4;
  report.context.agreement="supports";
  report.setup={...report.setup,state:"ready",entryZone:[117.3,117.4],protectiveStop:116,grossRewardRisk:2.26,netRewardRisk:2.1,costsBps:10,confirmationTs:report.candles.at(-3)!.ts,retestTs:report.candles.at(-2)!.ts,expiresAt:Date.now()+60_000,missing:[]};
  return report;
}
test("both tiers expose Market and Limit review with the same report entry, TP and SL",()=>{
  for(const tier of ["quick","pro"] as const){const report=readyFixture(tier),onTrade=()=>{};
    for(const html of [renderToStaticMarkup(createElement(GlobalResearchReport,{report,onTrade})),renderToStaticMarkup(createElement(TelegramResearchReport,{report,onTrade})),renderToStaticMarkup(createElement(AnalysisReport,{data:{global:report},nfa:"Research",onTrade}))]){
      assert.match(html,/Review Market buy/);assert.match(html,/Review Limit buy/);assert.match(html,/Entry, TP and SL carry into the Spot ticket/);
    }
    for(const orderType of ["market","limit"] as const){const intent=buildReportBuyIntent({global:report},orderType);assert.equal(intent.orderType,orderType);assert.equal(intent.entryPrice,117.4);assert.equal(intent.takeProfit,120.56);assert.equal(intent.stopLoss,116);assert.equal(intent.pair,"SOL-USDT");assert.equal(intent.timeframe,"1H");assert.equal(intent.sourceTier,tier);}
    report.setup.expiresAt=Date.now()-1;assert.throws(()=>buildReportBuyIntent({global:report},"market"),/not ready/);
    const expiredHtml=renderToStaticMarkup(createElement(GlobalResearchReport,{report,onTrade}));assert.doesNotMatch(expiredHtml,/Review Market buy|Review Limit buy/);assert.match(expiredHtml,/Open manual Market ticket/);
  }
});
test("Telegram handoff carries the chosen order type and ignores URL price overrides",()=>{
  const report=readyFixture();for(const orderType of ["market","limit"] as const){const intent=buildTelegramReportBuyIntent({global:report},`#telegramReport=fixture&orderType=${orderType}&entryPrice=1&takeProfit=2&stopLoss=3`);assert.equal(intent.orderType,orderType);assert.equal(intent.entryPrice,117.4);assert.equal(intent.takeProfit,120.56);assert.equal(intent.stopLoss,116);}
  for(const fragment of ["#telegramReport=fixture","#orderType=unsupported"])assert.equal(buildTelegramReportBuyIntent(report,fragment).orderType,"limit");
});
test("malformed canonical reports never load contradictory legacy protection",()=>{
  const report=readyFixture();report.setup.triggerLevelId="floor";
  const data={global:report,executionPlan:{pair:"SOL-USDT",buy:{trigger:115,takeProfit:130,stopLoss:100}}};
  for(const orderType of ["market","limit"] as const)for(const build of [buildReportBuyIntent,buildReportManualBuyIntent])assert.throws(()=>build(data,orderType),/Global setup is invalid/);
});
test("cancelled and expired web and Mini App plans clearly remove pending protection",()=>{
  for(const state of ["cancelled","expired"] as const)for(const lang of ["en","zh"] as const){const report=globalDesignFixture("pro",lang);report.setup.state=state;for(const Component of [GlobalResearchReport,TelegramResearchReport]){const html=renderToStaticMarkup(createElement(Component,{report,onTrade:()=>{}}));assert.match(html,new RegExp(lang==="zh"?state==="cancelled"?"计划已取消":"计划已过期":state==="cancelled"?"Plan cancelled":"Plan expired"));assert.doesNotMatch(html,/Pending the observed retest|等待实际回测|Review Market buy|Review Limit buy/);assert.match(html,/Net R:R|费用后收益风险比/);}}
});

test("manual Market and Limit review preserve observed protection without promoting Watching",()=>{
  const report=readyFixture();report.setup.state="watching";report.setup.netRewardRisk=null;report.setup.costsBps=null;report.setup.missing=["execution_costs"];
  for(const orderType of ["market","limit"] as const){const intent=buildReportManualBuyIntent({global:report},orderType);assert.equal(intent.entryPrice,117.4);assert.equal(intent.takeProfit,120.56);assert.equal(intent.stopLoss,116);assert.equal(intent.orderType,orderType);assert.equal(intent.reportSetupMode,"manual");assert.match(intent.rationale,/Manual trade selected with risk acceptance/);const restored=buildTelegramReportBuyIntent({global:report},`#orderType=${orderType}&manual=1&stopLoss=1`);assert.deepEqual(restored,intent);}
  assert.equal(report.setup.state,"watching");assert.throws(()=>buildReportBuyIntent({global:report},"market"),/not ready/);
});
test("manual review leaves unobserved, cancelled and expired trade protection blank",()=>{
  for(const state of ["watching","cancelled","expired","none"] as const){const report=globalDesignFixture();report.setup.state=state;for(const orderType of ["market","limit"] as const){const intent=buildReportManualBuyIntent({global:report},orderType);assert.equal(intent.entryPrice,undefined);assert.equal(intent.takeProfit,undefined);assert.equal(intent.stopLoss,undefined);assert.equal(intent.pair,"SOL-USDT");assert.equal(intent.timeframe,"1H");assert.equal(intent.orderType,orderType);}const html=renderToStaticMarkup(createElement(GlobalResearchReport,{report,onTrade:()=>{}}));assert.match(html,/Open manual Market ticket/);assert.match(html,/Open manual Limit ticket/);}
  const stale=readyFixture();stale.setup.state="watching";stale.setup.expiresAt=Date.now()-1;assert.equal(buildReportManualBuyIntent({global:stale},"limit").stopLoss,undefined);
});
test("bearish web and Mini App reports expose owned Market/Limit sells with no short protection copied",()=>{
  const report=globalDesignFixture();report.setup.state="cancelled";
  for(const Component of [GlobalResearchReport,TelegramResearchReport]){
    const html=renderToStaticMarkup(createElement(Component,{report,onTrade:()=>{}}));assert.match(html,/data-plan-side="short"/);assert.match(html,/Review Market sell/);assert.match(html,/Review Limit sell/);assert.match(html,/Planned SL reference/);assert.match(html,/Plan cancelled/);
  }
  for(const orderType of ["market","limit"] as const){const draft=buildReportSellIntent({global:report},orderType);assert.equal(draft.side,"sell");assert.equal(draft.orderType,orderType);for(const key of ["entryPrice","takeProfit","stopLoss"] as const)assert.equal(draft[key],undefined);assert.match(draft.rationale,/owned Spot inventory/);assert.deepEqual(buildTelegramReportBuyIntent(report,`#side=sell&orderType=${orderType}&entryPrice=1&stopLoss=2`),draft);}
  report.paths[0].role="alternative";report.paths[1].role="main";assert.throws(()=>buildTelegramReportBuyIntent(report,"#side=sell"),/bearish research plan/);
});

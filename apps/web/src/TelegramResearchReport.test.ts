import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { TelegramResearchReport } from "./TelegramResearchReport";

test("Mini App report shows request context and useful research without provider/debug dumps",()=>{
  const report={service:"analysis_base",analysis:{headline:"Wait for confirmation",summary:"Evidence is incomplete",invalidation:{price:4.5,condition:"Support must hold"},riskNotes:["Thin liquidity"]},rawText:"PRIVATE_PROVIDER_DUMP",market:{candles:[{rawDebug:"DO_NOT_DISPLAY"}]},_telegramDelivery:"SECRET_CAPABILITY"};
  const html=renderToStaticMarkup(createElement(TelegramResearchReport,{report,context:{serviceId:"global-quick",input:{instId:"TON-USDT",timeframe:"4H"}}}));
  assert.match(html,/Global Quick/);assert.match(html,/TON-USDT/);assert.match(html,/4H/);assert.match(html,/Support must hold/);assert.match(html,/Thin liquidity/);assert.match(html,/Download research TXT/);assert.doesNotMatch(html,/PRIVATE_PROVIDER_DUMP|DO_NOT_DISPLAY|SECRET_CAPABILITY|Raw text/);
});
test("Mini App chart is shown only for a valid saved Pro snapshot",()=>{
  const report={service:"analysis_premium",instId:"TON-USDT",timeframe:"4H",chart:{candles:[{ts:1,low:4.5,high:4.9,close:4.7},{ts:2,low:4.6,high:5,close:4.8}]},analysis:{headline:"Conditional structure"}};
  const html=renderToStaticMarkup(createElement(TelegramResearchReport,{report}));assert.match(html,/Enlarge report chart/);assert.match(html,/data:image\/svg\+xml/);assert.match(html,/Original report snapshot/);
  const quick=renderToStaticMarkup(createElement(TelegramResearchReport,{report,context:{serviceId:"global-quick"}}));assert.doesNotMatch(quick,/Enlarge report chart/);
});

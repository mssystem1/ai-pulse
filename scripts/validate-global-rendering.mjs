/** Read-only renderer validation. --fetch obtains public OHLCV; no wallet,
 * model, Telegram send, or paid report checkout is used by this script.
 * Build first. Later runs can reuse the saved local market archive. */
import fs from "node:fs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildMarketContext } from "../packages/market/dist/index.js";
import { prepareGlobalReport, globalContextTimeframe } from "../packages/analysis/dist/index.js";
import { candleCloseTime, GlobalReportSchema } from "../packages/schemas/dist/index.js";
import { globalLevelPrice, globalReportChartSvg } from "../packages/domain/dist/index.js";
import { telegramResearchMessage, telegramResearchCaption, formatTelegramResearch, renderTelegramResearchChart } from "../apps/api/dist/telegramResearch.js";

const frames = ["15m", "1H", "4H", "1D", "1W"];
const archive = ".tmp/global-timeframes-market.json";
fs.mkdirSync(".tmp/global-timeframes", { recursive: true });
fs.mkdirSync("docs/previews/timeframes", { recursive: true });
if (process.argv.includes("--fetch") || process.argv.includes("--fetch-missing")) {
  const preserved = process.argv.includes("--fetch-missing") && fs.existsSync(archive) ? JSON.parse(fs.readFileSync(archive, "utf8")) : [];
  const observed = [];
  for (const timeframe of frames) {
    const saved = preserved.find(row => row.timeframe === timeframe);
    if (saved) { observed.push(saved); continue; }
    const contextFrame = globalContextTimeframe(timeframe);
    const [primary, context] = await Promise.all([
      buildMarketContext({ instId: "BTC-USDT", timeframe, candleLimit: 520, completedOnly: true }),
      buildMarketContext({ instId: "BTC-USDT", timeframe: contextFrame, candleLimit: 300, completedOnly: true }),
    ]);
    assert.equal(primary.bar, timeframe);
    assert.equal(context.bar, contextFrame);
    assert.ok(primary.candles.length >= 233 && context.candles.length >= 55, "Missing indicator warmup");
    observed.push({ timeframe, primary, context });
  }
  fs.writeFileSync(archive, JSON.stringify(observed));
}
assert.ok(fs.existsSync(archive), "Run with --fetch to save observed public market data first");
const observed = JSON.parse(fs.readFileSync(archive, "utf8"));
const results = [], chat = {};
for (const { timeframe, primary, context } of observed) {
  for (const tier of ["quick", "pro"]) {
    const report = prepareGlobalReport({ market: primary, tier: tier === "pro" ? "premium" : "base", contextMarket: tier === "pro" ? context : null });
    report.narrative = {
      headline: `BTC-USDT ${timeframe} · renderer validation`,
      summary: "This view validates chart and export layout using observed completed market candles. It contains no new model opinion.",
      reasons: [], riskNotes: [], limitations: ["Renderer validation only; this is not a purchased model report."],
      disclaimer: "Research display validation · no execution instruction.",
    };
    GlobalReportSchema.parse(report);
    assert.equal(report.snapshot.timeframe, timeframe);
    assert.ok(report.candles.every(c => candleCloseTime(c.ts, timeframe) <= Date.parse(report.snapshot.observedAt)));
    if (tier === "pro") {
      assert.equal(report.context.timeframe, globalContextTimeframe(timeframe));
      assert.equal(report.context.status, "available");
      assert.ok(report.context.candles.every(c => candleCloseTime(c.ts, report.context.timeframe) <= Date.parse(report.snapshot.observedAt)));
    }
    const key = `${timeframe.toLowerCase()}-${tier}`, prefix = `docs/previews/timeframes/${key}`;
    const message = telegramResearchMessage(report), caption = telegramResearchCaption(report), txt = formatTelegramResearch(report);
    const svg = globalReportChartSvg(report), png = renderTelegramResearchChart(report);
    assert.ok(svg && png); assert.ok(message.length <= 3900 && caption.length <= 1024 && png.length < 10_000_000);
    for (const id of [report.setup.triggerLevelId, report.setup.invalidationLevelId, ...report.setup.targetIds].filter(Boolean)) {
      const price = globalLevelPrice(report, id);
      for (const output of [message, caption, txt, svg]) assert.ok(output.includes(price), `Level mismatch: ${key} / ${id}`);
    }
    const duration = { "15m": "15-minute", "1H": "1-hour", "4H": "4-hour", "1D": "1-day", "1W": "1-week" }[timeframe];
    for (const output of [message, caption, txt, svg]) assert.ok(output.includes(duration));
    if (timeframe === "1W" && tier === "pro") for (const output of [message, caption, txt, svg]) assert.ok(output.includes("1-month"));
    if (report.setup.pathId) assert.ok(message.includes(`completed ${timeframe} close above`));
    fs.writeFileSync(`.tmp/global-timeframes/${key}.json`, JSON.stringify(report));
    fs.writeFileSync(`${prefix}-chart.png`, png);
    fs.writeFileSync(`${prefix}-message.txt`, message);
    fs.writeFileSync(`${prefix}-caption.txt`, caption);
    fs.writeFileSync(`${prefix}-report.txt`, txt);
    chat[key] = { message, caption, image: `${key}-chart.png`, report: `${key}-report.txt` };
    results.push({ timeframe, tier, context: report.context.timeframe, primaryCandles: report.candles.length,
      contextCandles: report.context.candles.length, snapshot: report.snapshot.observedAt, setup: report.setup.state,
      wave: report.waveCount.status, pngBytes: png.length, messageCharacters: message.length, captionCharacters: caption.length,
      primarySha256: crypto.createHash("sha256").update(JSON.stringify(report.candles)).digest("hex") });
  }
}
fs.writeFileSync("docs/previews/timeframes/validation.json", JSON.stringify({ validatedAt: new Date().toISOString(), walletSpendUSDC: 0, modelCalls: 0, results }, null, 2));
const data = JSON.stringify(chat).replace(/</g, "\\u003c");
fs.writeFileSync("docs/previews/timeframes/telegram-preview.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Global Telegram rendering validation</title><style>*{box-sizing:border-box}body{margin:0;background:#d8e5dd;color:#17212b;font:15px/1.5 system-ui,sans-serif}main{max-width:900px;padding:18px;margin:auto}nav{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}button,select{padding:8px 12px;border:1px solid #87a797;border-radius:7px;background:#fff;font:inherit;color:#17212b}.bubble{max-width:480px;margin:14px 0;background:#fff;border-radius:13px;padding:13px 16px;overflow-wrap:anywhere}.bubble img{display:block;width:100%;height:auto;border-radius:8px}.caption{white-space:pre-wrap;font-size:13px;margin-top:10px}.message{white-space:pre-wrap}a{color:#1274ad}small{font-size:12px}</style></head><body><main><h2>Global Telegram · renderer validation</h2><p>Observed public market data. These examples verify layout and conditions; no new model forecast, payment, or Telegram message was sent.</p><nav><select id="frame" onchange="update()">${frames.map(f => `<option value="${f.toLowerCase()}">${f}</option>`).join("")}</select><button onclick="tier='quick';update()">Quick</button><button onclick="tier='pro';update()">Pro</button></nav><div class="bubble"><a id="original" target="_blank"><img id="chart" alt="Matching report chart"></a><div id="caption" class="caption"></div></div><div id="message" class="bubble message"></div><a id="txt">Full report TXT</a></main><script>const examples=${data};let tier='quick';function update(){const e=examples[document.getElementById('frame').value+'-'+tier];document.getElementById('chart').src=e.image;document.getElementById('original').href=e.image;document.getElementById('caption').textContent=e.caption;document.getElementById('message').innerHTML=e.message;document.getElementById('txt').href=e.report;}update();</script></body></html>`);
console.log(JSON.stringify({ validated: results.map(r => ({ timeframe: r.timeframe, tier: r.tier, context: r.context, primary: r.primaryCandles, higher: r.contextCandles, message: r.messageCharacters })), walletSpendUSDC: 0, modelCalls: 0 }));

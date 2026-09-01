import test from "node:test";
import assert from "node:assert/strict";
import { localizeUiText } from "./uiLocale.js";

test("localizes shared PULSE workspaces and preserves technical identifiers", () => {
  assert.equal(localizeUiText("zh", "Autopilot"), "自动驾驶");
  assert.equal(localizeUiText("zh", "Spot Trading"), "现货交易");
  assert.equal(localizeUiText("zh", "  Pending  "), "  待执行  ");
  assert.equal(localizeUiText("zh", "BTC-USDT"), "BTC-USDT");
  assert.equal(localizeUiText("en", "Autopilot"), "Autopilot");
});

test("localizes dynamic route and wallet copy", () => {
  assert.equal(localizeUiText("zh", "Choose a live pair on Base"), "在 Base 上选择实时交易对");
  assert.equal(localizeUiText("zh", "Live WETH/USDC route verified"), "WETH/USDC 实时路径已验证");
  assert.equal(localizeUiText("zh", "Buy WETH"), "买入 WETH");
});

test("localizes reports, recovery, docs and Autopilot runtime copy", () => {
  assert.equal(localizeUiText("zh", "Elliott-wave next paths"), "艾略特波浪后续路径");
  assert.equal(localizeUiText("zh", "Prediction report"), "预测市场报告");
  assert.equal(localizeUiText("zh", "Paid report history"), "付费报告历史");
  assert.equal(localizeUiText("zh", "How to read the trading report"), "如何阅读交易报告");
  assert.equal(localizeUiText("zh", "Autopilot is running for BTC-USDT. You can pause it or withdraw funds at any time."), "自动驾驶已为 BTC-USDT 启动。您可随时暂停或提取资金。");
  assert.equal(localizeUiText("zh", "Initial Autopilot deposit"), "自动驾驶初始存款");
  assert.equal(localizeUiText("zh", "Actual entry / exit"), "实际入场价 / 出场价");
  assert.equal(localizeUiText("zh", "is the timestamped OKX public spot last price."), "是带时间戳的 OKX 公共现货最新价。");
  assert.equal(localizeUiText("zh", "AI ENTRY PASS"), "AI 入场通行证");
  assert.equal(localizeUiText("zh", "2d 3h remaining"), "剩余 2 天 3 小时");
  assert.equal(localizeUiText("zh", "3 compact AI confirmations remaining"), "剩余 3 次精简 AI 确认");
  assert.equal(localizeUiText("zh", "Export CSV activity"), "导出 CSV 活动记录");
  assert.equal(localizeUiText("zh", "Confirmed fills"), "已确认成交");
  assert.equal(localizeUiText("zh", "2 buys · 2 sells"), "2 次买入 · 2 次卖出");
  assert.equal(localizeUiText("zh", "AUTOPILOT DASHBOARD"), "自动驾驶仪表板");
  assert.equal(localizeUiText("zh", "Pause · hold pass timer"), "暂停 · 停止通行证计时");
  assert.equal(localizeUiText("zh", "Exit protection only"), "仅执行退出保护");
  assert.equal(localizeUiText("zh", "Entry pass expired"), "入场通行证已到期");
  assert.equal(localizeUiText("zh", "PAUSED · no monitoring or entry checks"), "已暂停 · 不监控或检查入场");
  assert.equal(localizeUiText("zh", "All available decisions · newest first · CSV includes on-chain activity"), "全部可用决策 · 最新优先 · CSV 包含链上活动");
  assert.match(localizeUiText("zh", "Historical detail is partial: 100 of 155 evaluation rows survive from the former retention window. Lifetime evaluation, Hold and failure counters remain available. Confirmed on-chain Buy/Sell totals remain authoritative; future rows are retained in the complete journal."), /100 \/ 155/);
  assert.match(localizeUiText("zh", "Historical detail is partial: 100 evaluation rows survive, but the legacy total is unknown. The displayed evaluation, Hold and failure values are minimums, not invented lifetime totals. Confirmed on-chain Buy/Sell totals remain authoritative; future rows are retained in the complete journal."), /旧版总数未知/);
  assert.equal(localizeUiText("zh", "Global Quick → Spot Market or Limit"), "全球市场快速分析 → 现货市价或限价交易");
  assert.equal(localizeUiText("zh", "Close above SMA20; SMA20 below SMA50"), "收盘价高于 SMA20；SMA20 低于 SMA50");
  assert.equal(localizeUiText("zh", "Choose directly. A prepaid pass supplies compact AI entry confirmation only after the free technical gate passes."), "可直接选择。只有通过免费技术门槛后，预付通行证才会提供精简 AI 入场确认。");
  assert.equal(localizeUiText("zh", "connect to check"), "连接钱包后查看");
  assert.match(localizeUiText("zh", "The same eight services are advertised under the selected network prefix with typed schemas. Agentic Wallet signs Spot and Autopilot contract calls; payment uses native USDC."), /八项服务/);
});

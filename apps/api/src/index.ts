import { loadConfig } from "@pulse/config";
import { createApp } from "./app.js";
import { startTradeAutomation } from "./tradeAutomation.js";
import { startAutopilotAutomation } from "./autopilotAutomation.js";
import { startTelegramDeliveryWorker } from "./telegram.js";

const cfg = loadConfig();
const app = createApp(cfg);

if (process.env.NODE_ENV !== "test") {
  startTradeAutomation(cfg);
  startAutopilotAutomation(cfg);
  startTelegramDeliveryWorker();
  const server = app.listen(cfg.PORT, cfg.HOST, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║  ${cfg.productName.padEnd(8)} API · port ${String(cfg.PORT).padEnd(28)}║
║  ${cfg.productTagline.padEnd(54).slice(0, 54)}║
║  Grok ${cfg.GROK_MODEL.padEnd(20)} XAI: ${cfg.hasXaiKey ? "YES" : "NO "}           ║
║  Payment: ${cfg.paymentMode.toUpperCase().padEnd(8)} OKX keys: ${cfg.hasOkxCredentials ? "YES" : "NO "}            ║
║  Meta /v1/metadata · MCP /mcp · Free /v1/market/*        ║
╚══════════════════════════════════════════════════════════╝
`);
  });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    const releasing = app.locals.stopReportWorker?.();
    const closed = new Promise<void>(resolve => server.close(() => resolve()));
    try { await releasing; }
    catch (error) { console.error("Could not release report leases during shutdown", error); }
    await closed;
    clearTimeout(deadline);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

export { app, cfg };

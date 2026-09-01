import test from "node:test";
import assert from "node:assert/strict";
import { inspectTelegramConfiguration } from "./telegram.js";

test("Telegram configuration fails closed instead of using the API BASE_URL as a Mini App", () => {
  const inspected = inspectTelegramConfiguration({
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_BOT_USERNAME: "@pulsemi_bot",
    TELEGRAM_WEBHOOK_SECRET: "secret",
  });
  assert.equal(inspected.complete, false);
  assert.equal(inspected.miniAppUrl, "");
  assert.deepEqual(inspected.missing, ["TELEGRAM_MINI_APP_URL"]);
});

test("Telegram configuration requires an absolute HTTPS Mini App URL", () => {
  const base = {
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_BOT_USERNAME: "pulsemi_bot",
    TELEGRAM_WEBHOOK_SECRET: "secret",
  };
  assert.equal(inspectTelegramConfiguration({ ...base, TELEGRAM_MINI_APP_URL: "http://ai-pulse.tech" }).miniAppUrlError, "TELEGRAM_MINI_APP_URL must use HTTPS");
  assert.equal(inspectTelegramConfiguration({ ...base, TELEGRAM_MINI_APP_URL: "https://www.ai-pulse.tech" }).complete, true);
});

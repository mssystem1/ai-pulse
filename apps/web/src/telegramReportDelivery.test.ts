import test from "node:test";
import assert from "node:assert/strict";
import { ensureTelegramReportDelivery } from "./telegramReportDelivery";

test("signed direct launch requests permission before chat report checkout", async () => {
  let prompts = 0;
  await ensureTelegramReportDelivery({ initData: "signed-fixture", requestWriteAccess: callback => { prompts++; callback(true); } });
  assert.equal(prompts, 1);
});

test("existing message permission needs no additional prompt", async () => {
  await ensureTelegramReportDelivery({ initData: "signed-fixture", initDataUnsafe: { user: { allows_write_to_pm: true } }, requestWriteAccess: () => { throw Error("Unexpected prompt"); } });
});

test("declined permission, unsupported clients and unsigned previews stop before checkout", async () => {
  await assert.rejects(ensureTelegramReportDelivery({ initData: "signed-fixture", requestWriteAccess: callback => callback(false) }), /before checkout/);
  await assert.rejects(ensureTelegramReportDelivery({ initData: "signed-fixture", isVersionAtLeast: () => false, requestWriteAccess: () => { throw Error("Must not request an unsupported API"); } }), /Update Telegram/);
  await assert.rejects(ensureTelegramReportDelivery({ initData: "signed-fixture" }), /Update Telegram/);
  await assert.rejects(ensureTelegramReportDelivery({ initData: "", initDataUnsafe: { user: { allows_write_to_pm: true } } }), /Open this Mini App/);
});

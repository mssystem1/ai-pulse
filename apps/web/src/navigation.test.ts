import test from "node:test";
import assert from "node:assert/strict";
import { hrefForTab, tabFromHref } from "./navigation.js";

test("direct service URLs survive refresh and trailing slashes", () => {
  assert.equal(tabFromHref("https://pulse.test/autopilot"), "autopilot");
  assert.equal(tabFromHref("https://pulse.test/spot/"), "spot");
  assert.equal(tabFromHref("https://pulse.test/safety"), "safety");
});

test("legacy service links remain compatible and canonicalize", () => {
  assert.equal(tabFromHref("https://pulse.test/?service=prediction"), "prediction");
  assert.equal(tabFromHref("https://pulse.test/?service=reports"), "telegram");
  assert.equal(hrefForTab("https://pulse.test/?service=spot&job=one#ticket", "spot"), "/spot?job=one#ticket");
});

test("navigation preserves unrelated query and hash state", () => {
  assert.equal(hrefForTab("https://pulse.test/global?job=one#report", "autopilot"), "/autopilot?job=one#report");
});

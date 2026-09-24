import test from "node:test";
import assert from "node:assert/strict";
import { APPEARANCE_IDS, isAppearance, readAppearance } from "./appearancePreference.js";

test("Robinhood is an optional fifth appearance without changing the default", () => {
  assert.equal(APPEARANCE_IDS.length, 5);
  assert.equal(isAppearance("robinhood"), true);
  assert.equal(readAppearance(), "xlayer");
  assert.equal(readAppearance(undefined, "https://pulse.test/?pulseTheme=robinhood"), "robinhood");
});

test("existing choices survive and appearance reads never request the network preference", () => {
  for (const preference of APPEARANCE_IDS) {
    const storage = { getItem(key: string) { assert.equal(key, "pulse:appearance"); return preference; } };
    assert.equal(readAppearance(storage), preference);
    assert.equal(readAppearance(storage, "https://pulse.test/?pulseTheme=invalid"), preference);
  }
});

test("Robinhood links override appearance only and tolerate unavailable storage", () => {
  const storage = { getItem() { throw Error("Storage unavailable"); } };
  assert.equal(readAppearance(storage), "xlayer");
  assert.equal(readAppearance(storage, "https://pulse.test/portfolio?pulseTheme=robinhood"), "robinhood");
});

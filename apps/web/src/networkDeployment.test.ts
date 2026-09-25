import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("deployment template includes Robinhood in both API and browser network selectors", () => {
  const template = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
  const networks = (name: string) => template.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1].trim().split(",");
  for (const name of ["ENABLED_NETWORKS", "VITE_ENABLED_NETWORKS"]) {
    assert.ok(networks(name)?.includes("robinhood"), `${name}: Robinhood must be selectable`);
    assert.equal(new Set(networks(name)).size, networks(name)?.length);
  }
  assert.deepEqual(networks("ENABLED_NETWORKS"), networks("VITE_ENABLED_NETWORKS"));
});

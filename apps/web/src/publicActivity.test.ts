import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePublicActivity, publicActivityNetworks, PublicActivityBreakdown, type PublicActivity } from "./PublicActivity.js";

const count = (value: number) => ({ count: value, partial: 0, firstAt: "2026-10-04T10:00:00Z", lastAt: "2026-10-04T10:00:00Z" });
function snapshot(mainnet = false): PublicActivity {
  return { version: 1, scope: "platform", persistence: "durable", asOf: "2026-10-05T10:00:00Z", stale: false,
    research: { global: count(mainnet ? 24 : 22), prediction: null, risk: null },
    networks: [
      { chain: "eip155:8453", label: "Base", environment: "mainnet", research: { global: count(3), prediction: null, risk: null } },
      { chain: "eip155:5042002", label: "Arc Testnet", environment: "testnet", research: { global: count(19), prediction: null, risk: null } },
      ...(mainnet ? [{ chain: "eip155:5042", label: "Arc Mainnet", environment: "mainnet" as const, research: { global: count(2), prediction: null, risk: null } }] : []),
    ] };
}

test("older activity snapshots show Arc mainnet with unknown coverage while preserving all testnet observations", () => {
  const data = snapshot(), before = JSON.stringify(data);
  assert.ok(parsePublicActivity(data));
  const coverage = publicActivityNetworks(data);
  assert.equal(coverage.mainnets.length, 5);
  const arc = coverage.mainnets.find(network => network.chain === "eip155:5042")!;
  assert.equal(arc.label, "Arc Mainnet");
  assert.deepEqual(arc.research, { global: null, prediction: null, risk: null });
  assert.equal(coverage.retired[0].research.global?.count, 19);
  assert.equal(JSON.stringify(data), before);
});

test("mainnet and retired Arc delivery counts remain distinct in the actual rendered chart and tables", () => {
  const data = snapshot(true);
  assert.ok(parsePublicActivity(data));
  const html = renderToStaticMarkup(createElement(PublicActivityBreakdown, { data, loading: false, retry() {} }));
  const chart = html.match(/<figure\b.*?<\/figure>/s)![0];
  assert.match(chart, /Arc Mainnet/);
  assert.match(chart, /Global: 2/);
  assert.doesNotMatch(chart, /Arc Testnet/);
  assert.match(html, /Observed mainnet total<\/th><td>5<\/td>/);
  const history = html.match(/<details class="landing-stat-method landing-retired-activity">.*?<\/details>/s)![0];
  assert.match(history, /Arc Testnet/);
  assert.match(history, /<td>19<\/td>/);
  assert.equal(data.research.global?.count, 24);
});

test("rendering missing Arc observations does not invent a zero or reuse testnet reports", () => {
  const html = renderToStaticMarkup(createElement(PublicActivityBreakdown, { data: snapshot(), loading: false, retry() {} }));
  const chart = html.match(/<figure\b.*?<\/figure>/s)![0];
  assert.match(chart, /Arc Mainnet\. Global: unavailable; Prediction: unavailable; Risk Guard: unavailable/);
  assert.match(chart, /Coverage unavailable/);
  assert.doesNotMatch(chart, /Arc Testnet/);
  assert.match(html, /Observed mainnet total<\/th><td>3<\/td>/);
});

test("activity cannot claim Arc testnet reports are mainnet or mark mainnet 5042 as testnet", () => {
  for (const [chain, environment] of [["eip155:5042002", "mainnet"], ["eip155:5042", "testnet"]] as const) {
    const data = snapshot();
    data.networks[1] = { ...data.networks[1], chain, environment };
    assert.equal(parsePublicActivity(data), null);
  }
  const data = snapshot();
  data.networks[1].label = "Arc Mainnet";
  assert.equal(publicActivityNetworks(data).retired[0].label, "Arc Testnet");
});

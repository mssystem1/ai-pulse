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

test("Terminal purchases are the fourth mainnet chart series and table column; unknown counts stay unavailable", () => {
  const unknown = renderToStaticMarkup(createElement(PublicActivityBreakdown,{data:snapshot(),loading:false,retry(){}}));
  const unknownChart = unknown.match(/<figure\b.*?<\/figure>/s)![0];
  assert.match(unknownChart,/Trading Terminal/);
  assert.match(unknownChart,/Trading Terminal purchases: unavailable/);
  assert.match(unknown,/Observed mainnet total<\/th><td>3<\/td><td>—<\/td>/);
  assert.doesNotMatch(unknown,/landing-terminal-pass-stats|24h<\/th>|7d<\/th>|30d<\/th>/);

  const data = snapshot(true);
  data.networks.push({chain:"eip155:196",label:"X Layer",environment:"mainnet",research:{global:null,prediction:null,risk:null}});
  data.terminalPasses={count:6,byChain:[
    {count:2,byDuration:{"24h":1,"7d":1,"30d":0},firstAt:"2026-10-01T00:00:00Z",lastAt:"2026-10-04T00:00:00Z",chain:"eip155:8453",label:"Base"},
    {count:4,byDuration:{"24h":2,"7d":1,"30d":1},firstAt:"2026-10-01T00:00:00Z",lastAt:"2026-10-04T00:00:00Z",chain:"eip155:196",label:"X Layer"},
  ]};
  assert.ok(parsePublicActivity(data));
  const html=renderToStaticMarkup(createElement(PublicActivityBreakdown,{data,loading:false,retry(){}}));
  const chart=html.match(/<figure\b.*?<\/figure>/s)![0];
  assert.match(chart,/Risk Guard[\s\S]*Trading Terminal/);
  assert.match(chart,/class="activity-series-terminal"[^>]+title="Trading Terminal purchases: 4"/);
  assert.match(chart,/X Layer\. Global: unavailable; Prediction: unavailable; Risk Guard: unavailable; Trading Terminal purchases: 4/);
  assert.match(chart,/X Layer[\s\S]*?<div class="landing-chart-total">4<small>Partial coverage<\/small><\/div>/);
  assert.match(html,/Observed mainnet total<\/th><td>5<\/td><td>—<\/td><td>—<\/td><td>6<\/td>/);
  assert.match(html,/<th scope="col">Risk Guard<\/th><th scope="col">Trading Terminal<\/th>/);
  assert.match(html,/<th scope="row">X Layer<small>Mainnet<\/small><\/th><td>—<\/td><td>—<\/td><td>—<\/td><td>4<\/td>/);
  assert.doesNotMatch(html,/landing-terminal-pass-stats|<th scope="col">24h<\/th>|<th scope="col">7d<\/th>|<th scope="col">30d<\/th>/);
  assert.match(html,/each completed paid pass purchase once across all durations, including renewals/i);
});

test("Terminal purchase data rejects inconsistent totals, unknown durations and testnet attribution", () => {
  const data=snapshot();
  data.terminalPasses={count:3,byChain:[{count:3,byDuration:{"24h":1,"7d":1,"30d":1},firstAt:"2026-10-01T00:00:00Z",lastAt:"2026-10-04T00:00:00Z",chain:"eip155:8453",label:"Base"}]};
  const invalid:unknown[]=[];
  const total=structuredClone(data);total.terminalPasses!.count=4;invalid.push(total);
  const duration=structuredClone(data);duration.terminalPasses!.byChain[0].byDuration={"24h":1,"7d":2,"year":0} as never;invalid.push(duration);
  const duplicate=structuredClone(data);duplicate.terminalPasses!.byChain.push(structuredClone(duplicate.terminalPasses!.byChain[0]));duplicate.terminalPasses!.count=6;invalid.push(duplicate);
  const testnet=structuredClone(data);testnet.terminalPasses!.byChain[0].chain="eip155:5042002";invalid.push(testnet);
  for(const candidate of invalid)assert.equal(parsePublicActivity(candidate),null);
});

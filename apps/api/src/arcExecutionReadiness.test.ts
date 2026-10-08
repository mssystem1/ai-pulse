import test from "node:test";
import assert from "node:assert/strict";
import type { AppConfig } from "@pulse/config";
import { arcAutomationReadiness } from "./arcExecutionReadiness.js";
import { assertRobinhoodQuoteIdentity } from "./okxDex.js";
import { executionContracts } from "./executionContracts.js";
import { decodeAbiParameters, decodeFunctionData, deploylessCallViaBytecodeBytecode, encodeFunctionResult, multicall3Abi, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const evidenceAbi = parseAbi([
  "function registry() view returns(address)", "function oracle() view returns(address)",
  "function automationPaused() view returns(bool)", "function approvedAdapters(address) view returns(bool)",
  "function spotKeepers(address) view returns(bool)", "function autopilotExecutors(address) view returns(bool)",
  "function approvedRouters(address) view returns(bool)", "function approvedSpenders(address) view returns(bool)",
  "function updaters(address) view returns(bool)",
]);

test("Arc execution uses its verified mainnet deployment and rejects an old testnet RPC", async t => {
  const names = ["ARC_PULSE_REGISTRY_ADDRESS", "ARC_ORACLE_ROUTER_ADDRESS", "ARC_EXECUTION_ADAPTER_ADDRESS", "ARC_SPOT_ORDER_FACTORY_ADDRESS", "ARC_SPOT_LIMIT_FACTORY_ADDRESS", "ARC_SPOT_BRACKET_FACTORY_ADDRESS", "ARC_AUTOPILOT_VAULT_FACTORY_ADDRESS", "ARC_OKX_ROUTER_ADDRESS", "ARC_OKX_APPROVAL_ADDRESS", "FEATURE_ARC_TRADING"];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  for (const name of names) delete process.env[name];
  const cfg = { enabledNetworks: ["arc"], FEATURE_ARC_MAINNET: true, hasOkxCredentials: true, ARC_RPC_URL: "https://arc-fixture.test", AUTOMATION_EXECUTOR_PRIVATE_KEY: `0x${"1".repeat(64)}`, TEST_WALLET_PRIVATE_KEY: "" } as AppConfig;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    const response = (request: { id: number }) => ({ jsonrpc: "2.0", id: request.id, result: "0x4cef52" });
    return Response.json(Array.isArray(body) ? body.map(response) : response(body));
  });
  assert.equal((await arcAutomationReadiness(cfg)).ready, false);
  assert.equal(calls, 0);
  assert.equal(executionContracts("arc").registry.toLowerCase(), "0x67e14b9545b069afbd78e195ec37914466e1807f");
  process.env.FEATURE_ARC_TRADING = "1";
  assert.match((await arcAutomationReadiness(cfg)).reason!, /wrong network/);
  assert.equal(calls, 1);
});

test("Arc quotes cannot reuse testnet identity, another token or another amount", () => {
  const input = { chainId: "5042", fromTokenAddress: "0x3600000000000000000000000000000000000000", toTokenAddress: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB", amount: "100000" };
  const raw = { chainIndex: "5042", fromToken: { tokenContractAddress: input.fromTokenAddress }, toToken: { tokenContractAddress: input.toTokenAddress }, fromTokenAmount: "100000", toTokenAmount: "30000000000000" };
  assert.doesNotThrow(() => assertRobinhoodQuoteIdentity(raw, input));
  for (const update of [{ chainIndex: "5042002" }, { fromTokenAmount: "100001" }, { toTokenAmount: "0" }, { toToken: { tokenContractAddress: `0x${"3".repeat(40)}` } }]) assert.throws(() => assertRobinhoodQuoteIdentity({ ...raw, ...update }, input), /Arc mainnet quote/);
});

test("Arc execution fallback rechecks complete mainnet evidence and preserves every negative gate", async t => {
  const names = ["ARC_PULSE_REGISTRY_ADDRESS", "ARC_ORACLE_ROUTER_ADDRESS", "ARC_EXECUTION_ADAPTER_ADDRESS", "ARC_SPOT_ORDER_FACTORY_ADDRESS", "ARC_SPOT_LIMIT_FACTORY_ADDRESS", "ARC_SPOT_BRACKET_FACTORY_ADDRESS", "ARC_AUTOPILOT_VAULT_FACTORY_ADDRESS", "ARC_OKX_ROUTER_ADDRESS", "ARC_OKX_APPROVAL_ADDRESS", "FEATURE_ARC_TRADING"];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  for (const name of names) delete process.env[name];
  process.env.FEATURE_ARC_TRADING = "1";
  const cfg = { enabledNetworks: ["arc"], FEATURE_ARC_MAINNET: true, hasOkxCredentials: true,
    ARC_RPC_URL: "https://primary.fixture.invalid", ARC_RPC_FALLBACK_URL: "https://fallback.fixture.invalid",
    ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY: `0x${"2".repeat(64)}`, AUTOMATION_EXECUTOR_PRIVATE_KEY: `0x${"1".repeat(64)}`, TEST_WALLET_PRIVATE_KEY: "" } as AppConfig;
  const arcSigner = privateKeyToAccount(cfg.ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY as `0x${string}`).address;
  const contracts = executionContracts("arc");
  type Options = { primaryFailure?: "early" | "late"; allUnavailable?: boolean; primaryChain?: number;
    fallbackChain?: number; missingCode?: boolean; incorrectFactory?: boolean; deniedRole?: boolean; paused?: boolean; insufficientGas?: boolean;
    negativePrimaryOnly?: boolean; partialFailure?: boolean; codeFailure?: boolean; malformed?: "empty" | "truncated" };
  const run = async (options: Options = {}, config = cfg, concurrent = false) => {
    const reads: Array<{ provider: string; method: string; functionName?: string }> = [];
    const httpCalls: Array<{ provider: string; methods: string[] }> = [];
    const fetchMock = t.mock.method(globalThis, "fetch", async (input, init) => {
      const provider = String(input).includes("primary") ? "primary" : "fallback";
      const payload = JSON.parse(String(init?.body));
      const requests = Array.isArray(payload) ? payload : [payload];
      httpCalls.push({ provider, methods: requests.map(request => request.method) });
      const unavailable = options.allUnavailable || (provider === "primary" && (options.primaryFailure === "early"
        || (options.primaryFailure === "late" && requests.some(request => request.method === "eth_call"))));
      if (unavailable) {
        reads.push(...requests.map(request => ({ provider, method: request.method })));
        return new Response("unavailable", { status: 503 });
      }
      const response = (request: { id: number; method: string; params: any[] }) => {
        reads.push({ provider, method: request.method, functionName: undefined });
        if (provider === "primary" && options.codeFailure && request.method === "eth_getCode" && request.params[0].toLowerCase() === contracts.oracleRouter.toLowerCase())
          return { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "fixture code read unavailable" } };
        const negative = !options.negativePrimaryOnly || provider === "primary";
        let result: string;
        if (request.method === "eth_chainId") result = `0x${(provider === "primary" ? options.primaryChain ?? 5042 : options.fallbackChain ?? 5042).toString(16)}`;
        else if (request.method === "eth_getCode") result = options.missingCode && negative ? "0x" : "0x6000";
        else if (request.method === "eth_gasPrice") result = "0x1";
        else if (request.method === "eth_getBalance") {
          assert.equal(request.params[0].toLowerCase(), arcSigner.toLowerCase(), "gas evidence must belong to the Arc-specific signer");
          result = options.insufficientGas ? "0x1" : "0x989680";
        }
        else if (request.method === "eth_call") {
          // Decode the actual viem deployless constructor and nested aggregate3.
          assert.equal(request.params[0].to, undefined);
          const [, data] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes" }],
            `0x${request.params[0].data.slice(deploylessCallViaBytecodeBytecode.length)}`);
          const { args } = decodeFunctionData({ abi: multicall3Abi, data });
          const responses = args[0].map(call => {
            const { functionName, args: callArgs } = decodeFunctionData({ abi: evidenceAbi, data: call.callData });
            if (["spotKeepers", "autopilotExecutors", "updaters"].includes(functionName))
              assert.equal(String(callArgs?.[0]).toLowerCase(), arcSigner.toLowerCase(), "on-chain roles must be checked for the Arc-specific signer");
            reads.push({ provider, method: "multicall", functionName });
            if (options.partialFailure && provider === "primary" && functionName === "updaters") return { success: false, returnData: "0x" };
            const value = functionName === "registry" || functionName === "oracle"
              ? options.incorrectFactory && negative ? `0x${"2".repeat(40)}` : functionName === "registry" ? contracts.registry : contracts.oracleRouter
              : functionName === "automationPaused" ? Boolean(options.paused && negative) : !(options.deniedRole && negative && functionName === "spotKeepers");
            return { success: true, returnData: encodeFunctionResult({ abi: evidenceAbi, functionName, result: value }) };
          });
          result = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: options.malformed && negative
            ? options.malformed === "empty" ? [] : responses.slice(0, -1) : responses });
        }
        else throw new Error(`Unexpected read-only RPC method: ${request.method}`);
        return { jsonrpc: "2.0", id: request.id, result };
      };
      return Response.json(Array.isArray(payload) ? requests.map(response) : response(payload));
    });
    try {
      const checks = concurrent ? await Promise.all([arcAutomationReadiness(config), arcAutomationReadiness({ ...config })]) : [await arcAutomationReadiness(config)];
      return { readiness: checks[0], checks, reads, httpCalls };
    }
    finally { fetchMock.mock.restore(); }
  };
  const assertCompleteFallback = (reads: Awaited<ReturnType<typeof run>>["reads"]) => {
    const fallback = reads.filter(read => read.provider === "fallback");
    assert.equal(fallback[0].method, "eth_chainId");
    assert.equal(fallback.filter(read => read.method === "eth_getCode").length, 9);
    for (const name of ["registry", "oracle"]) assert.equal(fallback.filter(read => read.functionName === name).length, 4);
    for (const name of ["automationPaused", "approvedAdapters", "spotKeepers", "autopilotExecutors", "approvedRouters", "approvedSpenders", "updaters"]) {
      assert.equal(fallback.filter(read => read.functionName === name).length, 1, name);
    }
    assert.equal(fallback.filter(read => read.method === "eth_gasPrice").length, 1);
    assert.equal(fallback.filter(read => read.method === "eth_getBalance").length, 1);
    assert.equal(fallback.filter(read => read.method === "eth_call").length, 1, "fifteen contract reads share one eth_call");
  };
  await t.test("healthy primary needs no fallback", async () => {
    const { readiness, reads, httpCalls } = await run();
    assert.deepEqual(readiness, { ready: true });
    assert.ok(reads.every(read => read.provider === "primary"));
    assert.equal(reads.filter(read => read.method !== "multicall").length, 13);
    assert.equal(httpCalls.length, 4, "thirteen fresh RPC methods require only four HTTP requests");
    assert.equal(httpCalls[1].methods.length, 9, "all contract bytecode reads share a batch");
    assert.deepEqual(httpCalls[3].methods, ["eth_gasPrice", "eth_getBalance"]);
  });
  await t.test("concurrent callers share reads but completed pause state is not cached", async () => {
    const shared = await run({}, cfg, true);
    assert.deepEqual(shared.checks, [{ ready: true }, { ready: true }]);
    assert.equal(shared.reads.filter(read => read.method !== "multicall").length, 13);
    const next = await run({ paused: true });
    assert.match(next.readiness.reason!, /paused on-chain/);
    assert.ok(next.reads.length > 0);
  });
  for (const primaryFailure of ["early", "late"] as const) await t.test(`${primaryFailure} primary outage restarts all checks on fallback`, async () => {
    const { readiness, reads } = await run({ primaryFailure });
    assert.deepEqual(readiness, { ready: true });
    assertCompleteFallback(reads);
  });
  await t.test("an empty fallback setting uses the same mainnet backup as execution clients", async () => {
    const { readiness, reads } = await run({ primaryFailure: "early" }, { ...cfg, ARC_RPC_FALLBACK_URL: "" });
    assert.deepEqual(readiness, { ready: true });
    assertCompleteFallback(reads);
  });
  await t.test("wrong primary chain is never masked by a healthy fallback", async () => {
    const { readiness, reads } = await run({ primaryChain: 5042002 });
    assert.match(readiness.reason!, /wrong network/);
    assert.deepEqual(reads, [{ provider: "primary", method: "eth_chainId", functionName: undefined }]);
  });
  await t.test("testnet fallback is rejected before contract reads", async () => {
    const { readiness, reads } = await run({ primaryFailure: "early", fallbackChain: 5042002 });
    assert.match(readiness.reason!, /wrong network/);
    assert.deepEqual(reads.map(read => read.method), ["eth_chainId", "eth_chainId"]);
  });
  for (const [option, reason] of [["missingCode", /no deployed bytecode/], ["incorrectFactory", /references do not match/],
    ["deniedRole", /not approved/], ["paused", /paused on-chain/], ["insufficientGas", /transaction gas/]] as const) {
    await t.test(`fallback cannot bypass ${option}`, async () => {
      const { readiness } = await run({ primaryFailure: "early", [option]: true });
      assert.equal(readiness.ready, false);
      assert.match(readiness.reason!, reason);
    });
  }
  await t.test("unavailable providers and duplicate URLs fail closed", async () => {
    const unavailable = await run({ allUnavailable: true });
    assert.match(unavailable.readiness.reason!, /temporarily unavailable/);
    assert.match(unavailable.readiness.reason!, /Primary: network identity: RPC HTTP 503/);
    assert.match(unavailable.readiness.reason!, /Fallback: network identity: RPC HTTP 503/);
    assert.doesNotMatch(unavailable.readiness.reason!, /https?:\/\/|PRIVATE_KEY/);
    assert.equal(unavailable.reads.length, 2);
    const duplicate = await run({ allUnavailable: true }, { ...cfg, ARC_RPC_FALLBACK_URL: ` ${cfg.ARC_RPC_URL} ` });
    assert.equal(duplicate.readiness.ready, false);
    assert.equal(duplicate.reads.length, 1);
  });
  await t.test("a partially failed multicall restarts complete evidence on fallback", async () => {
    const { readiness, reads } = await run({ partialFailure: true });
    assert.deepEqual(readiness, { ready: true });
    assertCompleteFallback(reads);
  });
  for (const malformed of ["empty", "truncated"] as const) await t.test(`${malformed} multicall cannot certify readiness`, async () => {
    const unavailable = await run({ malformed });
    assert.equal(unavailable.readiness.ready, false);
    assert.match(unavailable.readiness.reason!, /temporarily unavailable/);
    const recovered = await run({ malformed, negativePrimaryOnly: true });
    assert.deepEqual(recovered.readiness, { ready: true });
    assertCompleteFallback(recovered.reads);
  });
  for (const [option, reason] of [["missingCode", /no deployed bytecode/], ["incorrectFactory", /references do not match/],
    ["deniedRole", /not approved/], ["paused", /paused on-chain/]] as const) {
    await t.test(`partial read errors cannot hide primary ${option}`, async () => {
      const { readiness, reads } = await run({ [option]: true, negativePrimaryOnly: true,
        ...(option === "missingCode" ? { codeFailure: true } : { partialFailure: true }) });
      assert.equal(readiness.ready, false);
      assert.match(readiness.reason!, reason);
      assert.ok(reads.every(read => read.provider === "primary"));
    });
  }
});

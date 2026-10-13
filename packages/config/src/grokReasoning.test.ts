import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./index.js";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";

test("report configuration accepts Quick low and Pro medium with their configured token budgets", () => {
  const changes = {
    GROK_MODEL: "grok-4.5", GROK_REASONING_STANDARD: "low", GROK_REASONING_PREMIUM: "medium",
    GROK_MAX_INPUT_STANDARD: "16000", GROK_MAX_INPUT_PREMIUM: "32000",
    GROK_MAX_OUTPUT_STANDARD: "4096", GROK_MAX_OUTPUT_PREMIUM: "8192",
  };
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, changes);
    const config = loadConfig();
    assert.equal(config.GROK_REASONING_STANDARD, "low");
    assert.equal(config.GROK_REASONING_PREMIUM, "medium");
    assert.equal(config.GROK_MAX_INPUT_STANDARD, 16000);
    assert.equal(config.GROK_MAX_INPUT_PREMIUM, 32000);
    assert.equal(config.GROK_MAX_OUTPUT_STANDARD, 4096);
    assert.equal(config.GROK_MAX_OUTPUT_PREMIUM, 8192);
    process.env.GROK_REASONING_PREMIUM = "med";
    assert.throws(() => loadConfig(), /GROK_REASONING_PREMIUM/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("production report template and omitted effort variables both retain Quick low and Pro medium",()=>{
  const values=Object.fromEntries(Object.entries(parse(readFileSync(new URL("../../../.env.production.example",import.meta.url),"utf8"))).filter(([key])=>/^GROK_(?:MODEL|REASONING_|MAX_(?:INPUT|OUTPUT)_(?:STANDARD|PREMIUM)$)/.test(key)));
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  try{Object.assign(process.env,values);let config=loadConfig();assert.equal(config.GROK_REASONING_STANDARD,"low");assert.equal(config.GROK_REASONING_PREMIUM,"medium");assert.equal(config.GROK_MODEL,"grok-4.5");assert.equal(config.GROK_MAX_OUTPUT_PREMIUM,8192);
    delete process.env.GROK_REASONING_STANDARD;delete process.env.GROK_REASONING_PREMIUM;config=loadConfig();assert.equal(config.GROK_REASONING_STANDARD,"low");assert.equal(config.GROK_REASONING_PREMIUM,"medium");
  }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

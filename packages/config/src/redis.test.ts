import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loadConfig } from "./index.js";

test("Railway Redis + Blob works without Upstash credentials and rejects unresolved references", () => {
  const changes = {
    QUEUE_PROVIDER: "redis", REDIS_URL: "redis://default:test@localhost:6379", STORAGE_PROVIDER: "vercel_blob",
    BLOB_READ_WRITE_TOKEN: "test-token", REPORT_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
    BLOB_ACCESS: "public", KV_REST_API_URL: "", KV_REST_API_TOKEN: "",
  };
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, changes);
    assert.equal(loadConfig().QUEUE_PROVIDER, "redis");
    for (const value of ["", "${{Redis.REDIS_URL}}", "https://example.com", "redis://default:${{PASS}}@localhost:6379"]) {
      process.env.REDIS_URL = value;
      assert.throws(() => loadConfig(), /QUEUE_PROVIDER=redis requires/);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

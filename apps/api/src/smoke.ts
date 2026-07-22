/**
 * Local smoke: free resolve + paid routes with mock payment signature.
 * Usage: X402_MOCK=1 npm run smoke -w @pulse/api
 */
import { loadConfig } from "@pulse/config";
import { createApp } from "./app.js";

const cfg = { ...loadConfig(), X402_MOCK: true, PORT: 0 as unknown as number };
// force mock
process.env.X402_MOCK = "1";
const realCfg = loadConfig();
const app = createApp({ ...realCfg, X402_MOCK: true });

async function req(
  port: number,
  path: string,
  body?: unknown,
  pay = false,
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (pay) headers["PAYMENT-SIGNATURE"] = "mock-sig-preflight-demo-0001";
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, headers: res.headers };
}

const server = app.listen(0, "127.0.0.1", async () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const health = await req(port, "/healthz");
    console.log("health", health.status, health.json);

    const unauth = await req(port, "/v1/token/scan", {
      address: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    });
    console.log("token unpaid", unauth.status, Boolean(unauth.headers.get("payment-required")));

    const paid = await req(
      port,
      "/v1/preflight",
      {
        intent: "swap",
        fromToken: "0x0000000000000000000000000000000000000000",
        toToken: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
        amount: "2.5",
      },
      true,
    );
    console.log("preflight paid", paid.status, (paid.json as { verdict?: string }).verdict);

    const resolve = await req(port, "/v1/resolve", { query: "OKB" });
    console.log("resolve free", resolve.status);

    console.log("SMOKE_OK");
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    server.close();
  }
});

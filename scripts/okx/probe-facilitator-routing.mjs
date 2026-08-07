import { createHmac } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env" });

const apiKey = process.env.OKX_XLAYER_API_KEY || process.env.OKX_API_KEY || "";
const secretKey = process.env.OKX_XLAYER_API_SECRET || process.env.OKX_API_SECRET || process.env.OKX_SECRET_KEY || "";
const passphrase = process.env.OKX_XLAYER_API_PASSPHRASE || process.env.OKX_API_PASSPHRASE || process.env.OKX_PASSPHRASE || "";

if (!apiKey || !secretKey || !passphrase) throw new Error("OKX credential triplet is not configured");

const origins = ["https://web3.okx.com", "https://www.okx.com"];
const paths = ["/api/v6/pay/x402/supported", "/api/v6/wallet/x402/supported"];

for (const origin of origins) {
  for (const path of paths) {
    const timestamp = new Date().toISOString();
    const signature = createHmac("sha256", secretKey)
      .update(`${timestamp}GET${path}`)
      .digest("base64");
    try {
      const response = await fetch(`${origin}${path}`, {
        headers: {
          "OK-ACCESS-KEY": apiKey,
          "OK-ACCESS-SIGN": signature,
          "OK-ACCESS-TIMESTAMP": timestamp,
          "OK-ACCESS-PASSPHRASE": passphrase,
        },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json().catch(() => ({}));
      // Deliberately emit only routing/status metadata. Never print credentials, headers, or response data.
      console.log(JSON.stringify({
        origin,
        path,
        httpStatus: response.status,
        providerCode: typeof body?.code === "string" ? body.code : null,
        providerMessage: typeof body?.msg === "string" ? body.msg : null,
        hasData: Array.isArray(body?.data),
      }));
    } catch (error) {
      console.log(JSON.stringify({
        origin,
        path,
        error: error instanceof Error ? error.name : "UnknownError",
      }));
    }
  }
}

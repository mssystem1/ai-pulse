import { parse } from "dotenv";

const operatorOnly = new Set(["ENABLE_SERVER_PAY", "RUN_LIVE_PAY"]);
const browserSecretName = /PRIVATE_KEY|SECRET|API_KEY|AUTH_TOKEN|ACCESS_TOKEN|BOT_TOKEN|PASSWORD|PASSPHRASE|MNEMONIC/;

/** Keep host exports separate and include changed settings, not only new keys. */
export function splitCloudEnv(template, local) {
  const railway = new Map(), vercel = new Map();
  for (const key of template.keys()) {
    const value = local.get(key);
    if (!value || key.startsWith("TEST_WALLET") || operatorOnly.has(key)) continue;
    if (key === "AUTOMATION_EXECUTOR_PRIVATE_KEY" && value.toLowerCase() === local.get("TEST_WALLET_PRIVATE_KEY")?.toLowerCase()) continue;
    if (key === "REPORT_ENCRYPTION_KEY" && new Set(value).size < 3) continue;
    if (key.startsWith("VITE_")) {
      if (browserSecretName.test(key)) throw new Error(`Refusing browser credential variable ${key}`);
      vercel.set(key, value);
    } else railway.set(key, value);
  }
  return { railway, vercel };
}

/** Apply explicit release settings without changing the local development file. */
export function prepareCloudRelease(exports, { production = false, apiOrigin } = {}) {
  if (apiOrigin !== undefined) {
    const url = new URL(apiOrigin);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Production API must be an HTTPS origin without credentials, path, query or fragment");
    }
    exports.railway.set("BASE_URL", url.origin);
    exports.railway.set("TELEGRAM_WEBHOOK_BASE_URL", url.origin);
    exports.vercel.set("VITE_API_URL", url.origin);
  }
  if (production) exports.railway.set("NODE_ENV", "production");
  return exports;
}

export function serializeCloudEnv(values, host) {
  return [`# ${host} configuration from local .env with explicit release overrides; review before import.`,
    host === "Railway" ? "# Contains server secrets. Keep private and import into Railway only." : "# Public browser configuration. Import into Vercel only.",
    ...[...values].map(([key, value]) => `${key}=${JSON.stringify(value)}`), ""].join("\n");
}

export function parseCloudEnv(text) {
  return new Map(Object.entries(parse(text)).filter(([key]) => /^[A-Z][A-Z0-9_]*$/.test(key)));
}

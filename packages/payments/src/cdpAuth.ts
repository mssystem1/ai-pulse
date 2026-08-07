import { randomBytes } from "node:crypto";
import { SignJWT, importJWK, importPKCS8 } from "jose";

export async function createCdpJwt(input: { keyId: string; keySecret: string; method: string; host: string; path: string }) {
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("hex");
  const decoded = Buffer.from(input.keySecret, "base64");
  const claims = { sub: input.keyId, iss: "cdp", uris: [`${input.method} ${input.host}${input.path}`] };
  if (decoded.length === 64) {
    const key = await importJWK({
      kty: "OKP", crv: "Ed25519", d: decoded.subarray(0, 32).toString("base64url"),
      x: decoded.subarray(32).toString("base64url"),
    }, "EdDSA");
    return new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", kid: input.keyId, typ: "JWT", nonce })
      .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 120).sign(key);
  }
  const key = await importPKCS8(input.keySecret, "ES256");
  return new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: input.keyId, typ: "JWT", nonce })
    .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 120).sign(key);
}

export function createCdpAuthHeaders(url: string, keyId: string, keySecret: string) {
  const parsed = new URL(url);
  const basePath = parsed.pathname.replace(/\/$/, "");
  const correlation = "sdk_language=typescript,source=pulse,source_version=3";
  return async () => {
    const auth = async (method: string, suffix: string) => ({
      Authorization: `Bearer ${await createCdpJwt({ keyId, keySecret, method, host: parsed.host, path: `${basePath}/${suffix}` })}`,
      "Correlation-Context": correlation,
    });
    return { verify: await auth("POST", "verify"), settle: await auth("POST", "settle"), supported: await auth("GET", "supported") };
  };
}

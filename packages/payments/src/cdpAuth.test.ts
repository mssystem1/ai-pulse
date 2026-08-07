import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeJwt, exportJWK, generateKeyPair } from "jose";
import { createCdpAuthHeaders } from "./cdpAuth.js";

it("creates request-bound CDP facilitator JWTs", async () => {
  const { privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  const jwk = await exportJWK(privateKey);
  const secret = Buffer.concat([Buffer.from(jwk.d!, "base64url"), Buffer.from(jwk.x!, "base64url")]).toString("base64");
  const headers = await createCdpAuthHeaders("https://api.cdp.coinbase.com/platform/v2/x402", "key-id", secret)();
  assert.match(headers.verify!.Authorization, /^Bearer /);
  const claims = decodeJwt(headers.verify!.Authorization.slice(7));
  assert.equal(claims.sub, "key-id");
  assert.deepEqual(claims.uris, ["POST api.cdp.coinbase.com/platform/v2/x402/verify"]);
  assert.ok(Number(claims.exp) > Number(claims.iat));
});

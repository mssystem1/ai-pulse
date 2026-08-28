import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { ReportHistoryAuth } from "./reportHistoryAuth.js";

const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

test("wallet signature creates a scoped, expiring report-access and recovery session", async () => {
  const auth = new ReportHistoryAuth();
  const now = Date.parse("2026-08-20T12:00:00.000Z");
  const challenge = await auth.issue(account.address, "arbitrum", now);
  assert.match(challenge.message, /retry an already-settled report/);
  const signature = await account.signMessage({ message: challenge.message });
  const authorized = await auth.authorize(account.address, "arbitrum", challenge.nonce, signature, now + 1_000);
  assert.deepEqual(await auth.authenticate(authorized.sessionToken, now + 2_000), {
    wallet: account.address.toLowerCase(), networkKey: "arbitrum", expiresAt: now + 1_000 + 15 * 60_000,
  });
  assert.equal(await auth.authenticate(authorized.sessionToken, now + 16 * 60_000), null);
  await assert.rejects(() => auth.authorize(account.address, "arbitrum", challenge.nonce, signature, now + 2_000), /invalid or expired/);
});

test("a challenge cannot authorize another wallet or network", async () => {
  const auth = new ReportHistoryAuth();
  const challenge = await auth.issue(account.address, "base");
  const signature = await account.signMessage({ message: challenge.message });
  await assert.rejects(() => auth.authorize(account.address, "arbitrum", challenge.nonce, signature), /invalid or expired/);
});

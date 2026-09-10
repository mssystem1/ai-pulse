// Offline, read-only incident triage. Never emits request signatures, tokens,
// recovery capabilities, private keys, payer IPs, or complete request bodies.
import { readFile } from "node:fs/promises";
import { readRdb } from "./rdb-reader.mjs";
import { selectPulseRecords } from "./rdb-scope.mjs";
const safeText = text => String(text || "").replace(/https?:\/\/\S+/g, "[URL]").replace(/0x[a-f0-9]{130,}/gi, "[signature]").slice(0, 700);
for (const file of process.argv.slice(2)) {
  const data = await readFile(file);
  if (file.endsWith(".rdb")) {
    for (const row of selectPulseRecords(readRdb(data).records)) {
      const key = row.key.toString();
      if (row.type !== "string" || !key.includes(":job:")) continue;
      const job = JSON.parse(row.value.toString());
      if (job.stage !== "manual_reconciliation") continue;
      console.log(JSON.stringify({ kind: "flagged-job", namespace: key.slice(0, key.indexOf(":job:")), id: job.id,
        network: job.networkKey, createdAt: job.createdAt, updatedAt: job.updatedAt, stage: job.stage, reportId: job.reportId,
        receipt: job.receipt ? { provider: job.receipt.provider, settlementMode: job.receipt.settlementMode, settlementResult: job.receipt.settlementResult,
          finality: job.receipt.finality, transaction: job.receipt.transactionHash || job.receipt.txHash } : null,
        events: job.events?.map(event => ({ stage: event.stage, at: event.at, detail: safeText(event.detail) })) }));
    }
    continue;
  }
  const har = JSON.parse(data.toString().replace(/^\uFEFF/, ""));
  for (const entry of har.log?.entries || []) {
    const url = new URL(entry.request.url);
    if (!/\/autopilot\/(pass|strategies|configure|register|readiness)/.test(url.pathname)) continue;
    let request = {}; try { request = JSON.parse(entry.request.postData?.text || "{}"); } catch {}
    let response = {}; const content = entry.response.content;
    try { response = JSON.parse(content?.encoding === "base64" ? Buffer.from(content.text, "base64").toString() : content?.text || "{}"); } catch {}
    if (entry.request.method === "GET") continue;
    const paymentHeaders = (entry.response.headers || []).filter(h => /^(payment-response|x-payment-response)$/i.test(h.name));
    const receipts = paymentHeaders.map(h => { try { const r = JSON.parse(Buffer.from(h.value, "base64").toString()); return { success:r.success, network:r.network, transaction:r.transaction, errorReason:safeText(r.errorReason) }; } catch {return {undecodable:true};} });
    console.log(JSON.stringify({ kind: "har-request", file: file.split(/[\\/]/).pop(), at: entry.startedDateTime, path: url.pathname,
      method: entry.request.method, status: entry.response.status, network: request.network || url.searchParams.get("network"), vault: request.vault,
      signedPayment: entry.request.headers.some(h=>/^(payment-signature|x-payment)$/i.test(h.name)),
      responseBodyPresent: Boolean(content?.text), error: typeof response.error === "string" ? safeText(response.error) : undefined,
      aiPass: response.aiPass ? { purchasedAt:response.aiPass.purchasedAt,expiresAt:response.aiPass.expiresAt,vault:response.aiPass.vault } : undefined, receipts }));
  }
}

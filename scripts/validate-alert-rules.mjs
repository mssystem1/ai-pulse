import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const path = new URL("../ops/pulse-alerts.yml", import.meta.url);
const document = parse(await readFile(path, "utf8"));
if (!Array.isArray(document?.groups) || document.groups.length === 0) throw new Error("Alert rules require groups");
const alerts = document.groups.flatMap((group) => {
  if (typeof group?.name !== "string" || !Array.isArray(group.rules)) throw new Error("Every alert group requires a name and rules");
  return group.rules;
});
const names = new Set();
for (const rule of alerts) {
  if (typeof rule?.alert !== "string" || !rule.alert) throw new Error("Every rule requires an alert name");
  if (names.has(rule.alert)) throw new Error(`Duplicate alert: ${rule.alert}`);
  names.add(rule.alert);
  if (typeof rule.expr !== "string" || !rule.expr.trim()) throw new Error(`${rule.alert} requires a PromQL expression`);
  if (!/^(warning|critical)$/.test(String(rule.labels?.severity))) throw new Error(`${rule.alert} requires warning or critical severity`);
  if (typeof rule.annotations?.summary !== "string" || typeof rule.annotations?.description !== "string") throw new Error(`${rule.alert} requires summary and description`);
}
const required = ["PulseApiDown", "PulsePaymentFailureRateHigh", "PulseUnfinishedJobsBacklog", "PulseManualReconciliationRequired", "PulseAiDailyCostLimitExceeded"];
for (const name of required) if (!names.has(name)) throw new Error(`Missing required alert: ${name}`);
console.log(`Validated ${alerts.length} PULSE alert rules across ${document.groups.length} groups.`);

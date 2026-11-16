import { parseIndicatorPackage, type IndicatorManifest } from "@pulse/domain";
import type { IndicatorListing } from "./terminalIndicatorClient";

export type IndicatorCircuitReference = { processor: string; circuitId: string; transactionHash?: string };
export type IndicatorCircuitRecommendation = { title: string; publisherName: string; manifest: IndicatorManifest; reference: IndicatorCircuitReference };

/** A registration identifies this exact numerical core, never a similar name,
 * output unit, signal or graph. Hosts still execute rolling/stateful work. */
export function compatibleIndicatorCircuit(a: IndicatorManifest, b: IndicatorManifest): boolean {
  if (!("runtime" in a) || !("runtime" in b)) return false;
  if (a.format === "pulse-indicator-v4" && !a.graph.nodes.some(node => node.kind === "kernel") || b.format === "pulse-indicator-v4" && !b.graph.nodes.some(node => node.kind === "kernel")) return false;
  return a.runtime.netlist === b.runtime.netlist && a.runtime.inputBits === b.runtime.inputBits && a.runtime.outputBits === b.runtime.outputBits;
}
export function recommendedIndicatorCircuits(manifest: IndicatorManifest | null, candidates: IndicatorCircuitRecommendation[]): IndicatorCircuitRecommendation[] {
  if (!manifest) return [];
  const unique = new Map<string, IndicatorCircuitRecommendation>();
  for (const candidate of candidates) if (compatibleIndicatorCircuit(manifest, candidate.manifest)) {
    const key = `${candidate.reference.processor.toLowerCase()}:${candidate.reference.circuitId}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}
export function indicatorPublisherName(manifest: Pick<IndicatorManifest, "author">, listing?: Pick<IndicatorListing, "author">): string {
  return listing?.author.trim() || manifest.author.trim() || "Unnamed publisher";
}
export function readCreatedIndicators(storage: Pick<Storage, "getItem">, wallet?: string | null): IndicatorManifest[] {
  const owner = wallet?.toLowerCase() ?? "local", values: unknown[] = [];
  try { const saved: unknown = JSON.parse(storage.getItem(`pulse-indicator-created:${owner}`) ?? "[]"); if (Array.isArray(saved)) values.push(...saved); } catch { /* One corrupt local draft cannot hide wallet purchases. */ }
  try { const saved = JSON.parse(storage.getItem(`pulse-indicator-draft:${owner}`) ?? "null"); if (saved) values.push(saved.manifest ?? saved); } catch { /* Other readable drafts remain available. */ }
  const latest = new Map<string, IndicatorManifest>();
  for (const value of values) { try { const manifest = parseIndicatorPackage(value); latest.set(manifest.id, manifest); } catch { /* Invalid local entries stay excluded; never execute browser text. */ } }
  return [...latest.values()].slice(0, 50);
}

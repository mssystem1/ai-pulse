import type { IndicatorManifest } from "@pulse/domain";

type RuntimeCalculation = "nand" | "hybrid" | "host";

export function IndicatorRuntimeBadge({ manifest, calculation, compact = false }: {
  manifest?: IndicatorManifest | null;
  calculation?: RuntimeCalculation;
  compact?: boolean;
}) {
  let kind = calculation;
  let label: string;
  let detail: string;

  if (kind === "nand") {
    label = "Tapeout NAND";
    detail = "The indicator's per-bar numerical kernel executes through Tapeout NAND.";
  } else if (kind === "hybrid") {
    label = "Host + Tapeout NAND";
    detail = "The delta kernel executes through Tapeout NAND; graph calculations and state run in the compatible host.";
  } else if (kind === "host") {
    label = "Tapeout portable · host calculated";
    detail = "This portable graph runs in the compatible host. Its Tapeout NAND kernel is not executed.";
  } else if (!manifest) {
    label = "Runtime details unavailable";
    detail = "Open the saved package to inspect its calculation; this listing or receipt does not supply runtime details.";
  } else if (manifest.format === "pulse-indicator-v4") {
    kind = manifest.graph.nodes.some(node => node.kind === "kernel") ? "hybrid" : "host";
    return <IndicatorRuntimeBadge calculation={kind} compact={compact}/>;
  } else {
    kind = "nand";
    label = "Tapeout NAND";
    detail = "The indicator's per-bar numerical kernel executes through Tapeout NAND.";
  }

  return <span className={`indicator-runtime-badge indicator-runtime-${kind ?? "unknown"}${compact ? " is-compact" : ""}`} title={detail} aria-label={`${label}. ${detail}`}>
    {compact ? label : <><b>{label}</b><span>{detail}</span></>}
  </span>;
}

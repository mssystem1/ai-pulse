import { globalArtifactTag, globalReportChartSvg, type GlobalReport, type GlobalChartOptions, type GlobalChartLayers } from "@pulse/domain";

export function downloadGlobalChart(report: GlobalReport, layers: GlobalChartLayers, options: Pick<GlobalChartOptions,"structure"|"fullHistory"> = {}) {
  const svg = globalReportChartSvg(report, { layers, ...options });
  if (!svg) return;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      if (!blob) return;
      const png = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = png;
      link.download = `PULSE-Global-${report.tier}-${report.snapshot.instId}-${report.snapshot.timeframe}-${globalArtifactTag(report)}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(png), 1000);
    }, "image/png");
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
}

/** Public pages never receive wallet state or report recovery capabilities. */
export function siteSurface(href: string, landingEnabled = false): "landing" | "app" | "shared" {
  const url = new URL(href);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/shared-report") return "shared";
  if (path === "/landing") return "landing";
  if (path !== "/" || url.hostname === "app.ai-pulse.tech") return "app";
  // Preserve existing root-based Telegram/report links, including fragments.
  if ([...url.searchParams.keys()].some(key => key !== "pulseTheme") || url.hash) return "app";
  return landingEnabled ? "landing" : "app";
}

export function applicationLink(href: string, path: string, theme: string, configuredOrigin?: string): string {
  const current = new URL(href);
  const preview = ["localhost", "127.0.0.1", "[::1]"].includes(current.hostname) || current.hostname.endsWith(".vercel.app");
  const origin = preview ? current.origin : configuredOrigin || "https://app.ai-pulse.tech";
  const url = new URL(path, origin);
  if (!/^\/(portfolio|global|prediction|safety|spot|autopilot|docs|telegram)$/.test(path)) throw new Error("Unsupported application destination");
  if (!["https:", ...(preview ? ["http:"] : [])].includes(url.protocol) || url.username || url.password) throw new Error("Invalid application origin");
  if (["xlayer", "base", "arbitrum", "arc-testnet"].includes(theme)) url.searchParams.set("pulseTheme", theme);
  return url.href;
}

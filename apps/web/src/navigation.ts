export type PulseTab = "analyze" | "prediction" | "spot" | "autopilot" | "telegram" | "docs" | "safety";

const PATH_BY_TAB: Record<PulseTab, string> = {
  analyze: "/global",
  prediction: "/prediction",
  safety: "/safety",
  spot: "/spot",
  autopilot: "/autopilot",
  telegram: "/telegram",
  docs: "/docs",
};

const TAB_BY_PATH = Object.fromEntries(
  Object.entries(PATH_BY_TAB).map(([tab, path]) => [path, tab]),
) as Record<string, PulseTab>;

const LEGACY_SERVICE: Record<string, PulseTab> = {
  global: "analyze",
  prediction: "prediction",
  reports: "telegram",
  telegram: "telegram",
  docs: "docs",
  safety: "safety",
  spot: "spot",
  autopilot: "autopilot",
};

export function tabFromHref(href: string): PulseTab {
  const url = new URL(href, "http://pulse.local");
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  return TAB_BY_PATH[pathname]
    || LEGACY_SERVICE[url.searchParams.get("service") || ""]
    || "analyze";
}

export function hrefForTab(href: string, tab: PulseTab) {
  const url = new URL(href, "http://pulse.local");
  url.pathname = PATH_BY_TAB[tab];
  url.searchParams.delete("service");
  return `${url.pathname}${url.search}${url.hash}`;
}

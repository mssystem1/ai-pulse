import { hrefForTab, tabFromHref } from "./navigation";

export function siteMetadata(href: string, surface: "landing" | "app" | "shared") {
  if (surface === "landing") return { title: "PULSE — Read the market. Trade your way.", canonical: "https://www.ai-pulse.tech/", robots: "index,follow" };
  if (surface === "shared") return { title: "PULSE — Shared research", canonical: "https://www.ai-pulse.tech/shared-report", robots: "noindex,nofollow" };
  const tab = tabFromHref(href);
  const title = {overview:"Portfolio",analyze:"Global Market",prediction:"Prediction Market",safety:"Risk Guard",spot:"Spot trading",autopilot:"Autopilot",telegram:"Telegram",docs:"Guides"}[tab];
  const path = new URL(hrefForTab("https://app.ai-pulse.tech/", tab), "https://app.ai-pulse.tech").pathname;
  return { title: `${title} · PULSE`, canonical: `https://app.ai-pulse.tech${path}`, robots: tab === "docs" ? "index,follow" : "noindex,follow" };
}

export function applySiteMetadata(surface: "landing" | "app" | "shared") {
  const metadata = siteMetadata(window.location.href, surface);
  document.title = metadata.title;
  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.append(canonical); }
  canonical.href = metadata.canonical;
  let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!robots) { robots = document.createElement("meta"); robots.name = "robots"; document.head.append(robots); }
  robots.content = metadata.robots;
  for (const [property, content] of [["og:title", metadata.title], ["og:url", metadata.canonical]]) {
    let element = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
    if (!element) { element = document.createElement("meta"); element.setAttribute("property",property); document.head.append(element); }
    element.content = content;
  }
}

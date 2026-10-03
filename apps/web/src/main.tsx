import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { siteSurface } from "./siteRouting";
import { applyAppearance, readAppearance } from "./appearancePreference";
import { applySiteMetadata } from "./siteMetadata";

let preferenceStorage: Storage | undefined;
try { preferenceStorage = localStorage; } catch { /* private browsing */ }
applyAppearance(readAppearance(preferenceStorage, window.location.href));
const entryUrl = new URL(window.location.href);
entryUrl.searchParams.delete("pulseTheme");
window.history.replaceState(window.history.state, "", `${entryUrl.pathname}${entryUrl.search}${entryUrl.hash}`);
const surface = siteSurface(window.location.href, import.meta.env.VITE_PUBLIC_LANDING_ENABLED === "1");
applySiteMetadata(surface);
const LandingPage = lazy(() => import("./LandingPage"));
const SharedReport = lazy(async () => ({ default: (await import("./SharedReport")).SharedReport }));
const TelegramLanding = lazy(async () => ({ default: (await import("./TelegramExperience")).TelegramLanding }));
const TelegramTonMiniApp = lazy(async () => ({ default: (await import("./TelegramTonMiniApp")).TelegramTonMiniApp }));
const TelegramWalletLinkPage = lazy(async () => {
  const [{ TelegramWalletLinkPage }, { AppKitProvider }] = await Promise.all([import("./TelegramWalletLinkPage"), import("./appkit")]);
  return { default: () => <AppKitProvider><TelegramWalletLinkPage /></AppKitProvider> };
});
const telegramPath = window.location.pathname.replace(/\/+$/, "");
const publicTelegramPage = telegramPath === "/telegram" && entryUrl.hostname !== "app.ai-pulse.tech";

// Shared research must not initialize wallet connectors or reconnect a session.
const NormalApp = lazy(async () => {
  const [{ App }, { AppKitProvider }] = await Promise.all([import("./App"), import("./appkit")]);
  return { default: () => <AppKitProvider><App /></AppKitProvider> };
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<p role="status">Opening PULSE…</p>}>
      {(telegramPath === "/ton-miniapp" || telegramPath === "/miniapp") ? <TelegramTonMiniApp /> : telegramPath === "/wallet-link" ? <TelegramWalletLinkPage /> : publicTelegramPage ? <TelegramLanding /> : surface === "shared" ? <SharedReport /> : surface === "landing" ? <LandingPage /> : <NormalApp />}
    </Suspense>
  </StrictMode>,
);

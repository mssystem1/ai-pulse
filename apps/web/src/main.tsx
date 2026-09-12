import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { SharedReport } from "./SharedReport";

// Shared research must not initialize wallet connectors or reconnect a session.
const NormalApp = lazy(async () => {
  const [{ App }, { AppKitProvider }] = await Promise.all([import("./App"), import("./appkit")]);
  return { default: () => <AppKitProvider><App /></AppKitProvider> };
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<p role="status">Opening PULSE…</p>}>
      {window.location.pathname.replace(/\/+$/, "") === "/shared-report" ? <SharedReport /> : <NormalApp />}
    </Suspense>
  </StrictMode>,
);

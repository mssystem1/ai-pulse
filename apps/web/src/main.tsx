import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { AppKitProvider } from "./appkit";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppKitProvider><App /></AppKitProvider>
  </StrictMode>,
);

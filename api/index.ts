/**
 * Vercel Serverless entry — same Express app as local `apps/api`.
 * Built packages must exist (`npm run build:vercel` before this runs).
 *
 * Rewrites in vercel.json map /v1/*, /mcp, /healthz, /brand/* → /api
 */
import { loadConfig } from "@pulse/config";
import { createApp } from "../apps/api/dist/app.js";

const cfg = loadConfig();
const app = createApp(cfg);

export default app;

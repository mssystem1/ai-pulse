import net from "node:net";
import { spawn, spawnSync } from "node:child_process";

const services = [
  { script: "dev:api", label: "API", url: "http://127.0.0.1:4000/healthz", port: 4000 },
  { script: "dev:web", label: "Web", url: "http://127.0.0.1:5173/", port: 5173 },
];

async function healthy(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
    return response.ok;
  } catch {
    return false;
  }
}

function portOccupied(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(750, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function spawnService(script) {
  return process.platform === "win32"
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm run ${script}`], {
        stdio: "inherit",
        windowsHide: true,
      })
    : spawn("npm", ["run", script], { stdio: "inherit" });
}

const children = [];
let stopping = false;

function stopTree(child) {
  if (child.killed || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) stopTree(child);
  process.exitCode = code;
}

async function main() {
  for (const service of services) {
    if (await healthy(service.url)) {
      console.log(`[dev] Reusing healthy ${service.label} at ${service.url}`);
      continue;
    }
    if (await portOccupied(service.port)) {
      throw new Error(
        `[dev] Port ${service.port} is occupied, but ${service.label} did not answer its health check. Stop that stale local process, then run npm run dev again.`,
      );
    }
    const child = spawnService(service.script);
    children.push(child);
    child.once("error", (error) => {
      console.error(error);
      stop(1);
    });
    child.once("exit", (code) => {
      if (!stopping && code !== null && code !== 0) stop(code);
    });
  }

  if (!children.length) {
    console.log("[dev] PULSE API and Web are already healthy; no duplicate processes were started.");
  }
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  stop(1);
});

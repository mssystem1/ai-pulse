import { spawn } from "node:child_process";

const children = ["dev:api", "dev:web"].map((script) =>
  process.platform === "win32"
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm run ${script}`], {
        stdio: "inherit",
        windowsHide: true,
      })
    : spawn("npm", ["run", script], { stdio: "inherit" }),
);

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = code;
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping && code !== null && code !== 0) stop(code);
  });
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

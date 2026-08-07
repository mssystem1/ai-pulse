#!/usr/bin/env node

/**
 * PULSE safe review runner for GitHub Codespaces, Linux, macOS, and Windows.
 *
 * IMPORTANT:
 * - This version NEVER calls `onchainos agent task-402-pay`.
 * - It preserves and signs the complete PAYMENT-REQUIRED challenge, including
 *   x402Version + resource + accepts.
 * - It replays a signed payment exactly once.
 * - It saves only a genuine HTTP 2xx service response as the task deliverable.
 * - It calls direct-accept only after delivery succeeds.
 * - It completes the task before asking for honest feedback.
 * - It never retries a paid HTTP replay automatically.
 *
 * Node.js: 22+
 */

import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve, join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

const IS_WINDOWS = process.platform === "win32";
const PROJECT_ROOT = process.cwd();
const RUNTIME_DIR = resolve(PROJECT_ROOT, ".pulse-review-runtime");
mkdirSync(RUNTIME_DIR, { recursive: true });

function loadEnvFiles(paths = [".env", ".env.wallets", ".env.scripts", ".env.scripts"]) {
  const file = resolve(PROJECT_ROOT, fileName);
  if (!existsSync(file)) return;

  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    let value = match[2].trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function envInteger(name, defaultValue, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

const DEFAULTS = {
  providerId: "8355",
  tokenAddress: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
  payTo: "0xa05b83c9a2228b1f4e32952a71e5b189df4f3973",
  network: "eip155:196",
  chainId: "196",
  cliTokenSymbol: "USDT",
  commandTimeoutMs: 180_000,
  loginTimeoutMs: 1_800_000,
  taskVisibleTimeoutMs: 120_000,
  lifecycleTimeoutMs: 180_000,
  pollMs: 3_000,
  requestTimeoutMs: 120_000,
};

const SERVICES = {
  scan: {
    configuredServiceId: "1dca2755-73c9-49ef-a8eb-6d17422c4a09",
    endpoint:
      "https://pulse-api-production-8d1f.up.railway.app/v1/token/scan",
    fee: "0.01",
    amountAtomic: "10000",
    title: "Quick token risk check",
    description:
      "Run a PULSE token risk scan for the supplied X Layer token contract.",
    summary: "PULSE X Layer token risk scan",
    body: {
      address: "0x382bb369d343125bfb2117af9c149795c6c65c50",
      chainId: "196",
    },
  },
  preflight: {
    configuredServiceId: "4edcfe03-d92c-43d6-af30-56094b1a273f",
    endpoint:
      "https://pulse-api-production-8d1f.up.railway.app/v1/preflight",
    fee: "0.05",
    amountAtomic: "50000",
    title: "BTC pre-trade safety check",
    description:
      "Run a PULSE pre-trade safety check for a planned BTC-USDT buy.",
    summary: "PULSE BTC-USDT pre-trade safety check",
    body: {
      intent: "generic",
      chainId: "196",
      notes: "Pre-trade safety check for a planned BTC-USDT buy.",
    },
  },
  base: {
    configuredServiceId: "7f19c37a-84c6-4d1c-b4b0-c5d0983b9fd4",
    endpoint:
      "https://pulse-api-production-8d1f.up.railway.app/v1/analysis/base",
    fee: "0.03",
    amountAtomic: "30000",
    title: "BTC 4H market analysis",
    description:
      "Run the PULSE base market analysis for BTC-USDT on the four-hour timeframe.",
    summary: "PULSE BTC-USDT 4H base analysis",
    body: {
      instId: "BTC-USDT",
      timeframe: "4H",
      lang: "en",
    },
  },
  premium: {
    configuredServiceId: "9c09da9f-742c-4a22-9572-b218450269e2",
    endpoint:
      "https://pulse-api-production-8d1f.up.railway.app/v1/analysis/premium",
    fee: "0.06",
    amountAtomic: "60000",
    title: "BTC daily premium analysis",
    description:
      "Run the PULSE premium market analysis for BTC-USDT on the daily timeframe.",
    summary: "PULSE BTC-USDT daily premium analysis",
    body: {
      instId: "BTC-USDT",
      timeframe: "1D",
      lang: "en",
    },
  },
};

const requestedServices = (
  process.env.SERVICES_TO_RUN || "scan,preflight,base,premium"
)
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const servicesToRun = [...new Set(requestedServices)];

for (const name of servicesToRun) {
  if (!SERVICES[name]) {
    throw new Error(
      `Unknown service "${name}". Use scan, preflight, base, or premium.`,
    );
  }
}

const CONFIG = {
  providerId: process.env.PROVIDER_ID || DEFAULTS.providerId,
  tokenAddress:
    process.env.XLAYER_USDT0_ADDRESS || DEFAULTS.tokenAddress,
  payTo: process.env.EXPECTED_PAY_TO || DEFAULTS.payTo,
  network: process.env.X402_NETWORK || DEFAULTS.network,
  chainId: process.env.XLAYER_CHAIN_ID || DEFAULTS.chainId,
  cliTokenSymbol:
    process.env.CLI_TOKEN_SYMBOL || DEFAULTS.cliTokenSymbol,
  servicesToRun,
  agentName: process.env.AGENT_NAME?.trim() || "",
  agentDescription:
    process.env.AGENT_DESCRIPTION?.trim() ||
    "User Agent for verified PULSE service interactions.",
  enableFeedback: envFlag("ENABLE_FEEDBACK", true),
  startA2a: envFlag("START_A2A_DAEMON", true),
  stopA2aOnExit: envFlag("STOP_A2A_DAEMON_ON_EXIT", true),
  openLoginUrl: envFlag("OPEN_LOGIN_URL", true),
  logoutOnExit: envFlag("LOGOUT_ON_EXIT", false),
  dryRun: envFlag("DRY_RUN", true),
  reportPath: resolve(
    PROJECT_ROOT,
    process.env.PULSE_REVIEW_REPORT ||
      "pulse-review-full-payload-report.json",
  ),
  commandTimeoutMs: envInteger(
    "COMMAND_TIMEOUT_MS",
    DEFAULTS.commandTimeoutMs,
    10_000,
    1_800_000,
  ),
  loginTimeoutMs: envInteger(
    "LOGIN_TIMEOUT_MS",
    DEFAULTS.loginTimeoutMs,
    30_000,
    3_600_000,
  ),
  taskVisibleTimeoutMs: envInteger(
    "TASK_VISIBLE_TIMEOUT_MS",
    DEFAULTS.taskVisibleTimeoutMs,
    10_000,
    600_000,
  ),
  lifecycleTimeoutMs: envInteger(
    "LIFECYCLE_TIMEOUT_MS",
    DEFAULTS.lifecycleTimeoutMs,
    10_000,
    900_000,
  ),
  pollMs: envInteger(
    "STATUS_POLL_MS",
    DEFAULTS.pollMs,
    500,
    30_000,
  ),
  requestTimeoutMs: envInteger(
    "REQUEST_TIMEOUT_MS",
    DEFAULTS.requestTimeoutMs,
    10_000,
    300_000,
  ),
};

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

let onchainosBin = null;
let okxA2aBin = null;
let a2aProcess = null;
let loggedInByScript = false;
let interrupted = false;

const report = {
  startedAt: new Date().toISOString(),
  finishedAt: null,
  status: "running",
  runner: "full-payment-required-v1",
  platform: {
    os: process.platform,
    node: process.version,
    cwd: PROJECT_ROOT,
  },
  configuration: {
    providerId: CONFIG.providerId,
    network: CONFIG.network,
    chainId: CONFIG.chainId,
    tokenAddress: CONFIG.tokenAddress,
    payTo: CONFIG.payTo,
    servicesToRun: CONFIG.servicesToRun,
    dryRun: CONFIG.dryRun,
    enableFeedback: CONFIG.enableFeedback,
  },
  cli: {},
  wallet: {},
  userAgent: {},
  serviceResolution: {},
  tasks: [],
  warnings: [],
  errors: [],
};

function writeReport() {
  const tmp = `${CONFIG.reportPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(report, null, 2), "utf8");
  renameSync(tmp, CONFIG.reportPath);
}

function stripAnsi(value) {
  return String(value || "").replace(
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    "",
  );
}

function extractJsonDocuments(text) {
  const source = stripAnsi(text);
  const documents = [];

  for (let start = 0; start < source.length; start += 1) {
    const opening = source[start];
    if (opening !== "{" && opening !== "[") continue;

    const stack = [opening];
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(char);
        continue;
      }

      if (char === "}" || char === "]") {
        const expected = char === "}" ? "{" : "[";
        if (stack.at(-1) !== expected) break;
        stack.pop();

        if (stack.length === 0) {
          const candidate = source.slice(start, index + 1);
          try {
            documents.push(JSON.parse(candidate));
          } catch {
            // Ignore log text with braces.
          }
          break;
        }
      }
    }
  }

  return documents;
}

function parseJsonLoose(text) {
  const clean = stripAnsi(text).trim();
  if (!clean) return null;

  try {
    return JSON.parse(clean);
  } catch {
    const docs = extractJsonDocuments(clean);
    return docs.length ? docs.at(-1) : null;
  }
}

function collectObjects(value, output = []) {
  if (!value || typeof value !== "object") return output;

  output.push(value);

  if (Array.isArray(value)) {
    for (const entry of value) collectObjects(entry, output);
  } else {
    for (const entry of Object.values(value)) {
      collectObjects(entry, output);
    }
  }

  return output;
}

function findDeepValue(value, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));

  for (const object of collectObjects(value)) {
    if (Array.isArray(object)) continue;

    for (const [key, candidate] of Object.entries(object)) {
      if (
        wanted.has(key.toLowerCase()) &&
        candidate !== null &&
        candidate !== undefined
      ) {
        return candidate;
      }
    }
  }

  return null;
}

function extractByRegex(text, regex) {
  const match = stripAnsi(text).match(regex);
  return match?.[1] || null;
}

function extractJobId(value, text = "") {
  const direct = findDeepValue(value, [
    "jobId",
    "job_id",
    "taskId",
    "task_id",
  ]);
  if (direct) return String(direct);

  return extractByRegex(text, /\bjobId:\s*(0x[a-fA-F0-9]{64})\b/i);
}

function extractAgentId(value) {
  const direct = findDeepValue(value, [
    "newAgentId",
    "agentId",
    "agent_id",
  ]);
  return direct === null ? null : String(direct);
}

function extractTxHash(value, text = "") {
  const direct = findDeepValue(value, [
    "txHash",
    "transaction",
    "transactionHash",
  ]);
  if (typeof direct === "string" && /^0x[a-fA-F0-9]{64}$/.test(direct)) {
    return direct;
  }
  return extractByRegex(text, /\b(0x[a-fA-F0-9]{64})\b/);
}

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function unwrapData(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.data !== undefined
  ) {
    return value.data;
  }
  return value;
}

function resolveExecutable(name, override) {
  if (override?.trim()) {
    const candidate = resolve(override.trim());
    if (!existsSync(candidate)) {
      throw new Error(`Configured executable not found: ${candidate}`);
    }
    return candidate;
  }

  const locator = IS_WINDOWS ? "where.exe" : "which";
  const located = spawnSync(locator, [name], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });

  if (located.status !== 0 || !located.stdout.trim()) {
    throw new Error(
      `${name} was not found in PATH.${
        IS_WINDOWS
          ? ` Set ${name === "onchainos" ? "ONCHAINOS_BIN" : "OKX_A2A_BIN"} to the full executable path.`
          : ""
      }`,
    );
  }

  return located.stdout.trim().split(/\r?\n/)[0];
}

function runProcess(executable, args, options = {}) {
  const {
    allowFailure = false,
    echo = true,
    timeoutMs = CONFIG.commandTimeoutMs,
  } = options;

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (IS_WINDOWS) {
          spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        // Best effort.
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (echo) process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (echo) process.stderr.write(text);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      const combined = `${stdout}${stderr}`;
      const result = {
        code: code ?? -1,
        stdout,
        stderr,
        combined,
        json: parseJsonLoose(stdout) || parseJsonLoose(combined),
      };

      if (timedOut) {
        const error = new Error(
          `${basename(executable)} ${args.join(" ")} timed out after ${timeoutMs} ms.`,
        );
        error.result = result;
        rejectPromise(error);
        return;
      }

      if (result.code !== 0 && !allowFailure) {
        const error = new Error(
          `${basename(executable)} ${args.join(" ")} failed with exit code ${result.code}.\n${combined}`,
        );
        error.result = result;
        rejectPromise(error);
        return;
      }

      resolvePromise(result);
    });
  });
}

async function runOnchainos(args, options = {}) {
  return runProcess(onchainosBin, args, options);
}

async function prompt(question) {
  return (await rl.question(question)).trim();
}

async function confirmExact(question, expected) {
  const answer = await prompt(`${question}\nType ${expected} to continue: `);
  return answer === expected;
}

function sleep(ms) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, ms),
  );
}

function normalizeStatus(value, text = "") {
  const direct = findDeepValue(value, [
    "taskStatus",
    "statusName",
    "status",
  ]);

  const candidates = [
    direct === null ? "" : String(direct),
    stripAnsi(text),
  ];

  const codeMap = {
    "0": "created",
    "1": "accepted",
    "2": "submitted",
    "3": "refused",
    "4": "disputed",
    "5": "complete",
    "6": "closed",
    "7": "expired",
    "8": "rejected",
    "9": "admin_stopped",
  };

  for (const raw of candidates) {
    const lower = raw.toLowerCase();

    for (const status of [
      "admin_stopped",
      "completed",
      "complete",
      "submitted",
      "accepted",
      "created",
      "refused",
      "disputed",
      "closed",
      "expired",
      "rejected",
    ]) {
      if (lower.includes(status)) {
        return status === "completed" ? "complete" : status;
      }
    }

    const numeric = lower.trim();
    if (codeMap[numeric]) return codeMap[numeric];
  }

  return null;
}

async function verifyCli() {
  onchainosBin = resolveExecutable(
    "onchainos",
    process.env.ONCHAINOS_BIN,
  );

  const version = await runOnchainos(["--version"], {
    echo: false,
    timeoutMs: 30_000,
  });

  report.cli.onchainosPath = onchainosBin;
  report.cli.onchainosVersion = version.combined.trim();

  console.log(`Onchain OS: ${report.cli.onchainosVersion}`);
  console.log(`Executable: ${onchainosBin}`);

  const requiredCapabilities = [
    ["payment", "pay", "--help"],
    ["agent", "create-task", "--help"],
    ["agent", "direct-accept", "--help"],
    ["agent", "task-deliverable-save", "--help"],
    ["agent", "complete", "--help"],
    ["agent", "feedback-submit", "--help"],
  ];

  for (const args of requiredCapabilities) {
    const result = await runOnchainos(args, {
      allowFailure: true,
      echo: false,
      timeoutMs: 30_000,
    });

    if (result.code !== 0) {
      throw new Error(
        `Required command is unavailable: onchainos ${args.slice(0, -1).join(" ")}. Update Onchain OS before running this script.`,
      );
    }
  }

  if (CONFIG.startA2a) {
    try {
      okxA2aBin = resolveExecutable(
        "okx-a2a",
        process.env.OKX_A2A_BIN,
      );
      report.cli.okxA2aPath = okxA2aBin;
    } catch (error) {
      report.warnings.push(String(error.message || error));
      console.warn("okx-a2a was not found; continuing without it.");
    }
  }
}

async function walletStatus() {
  const result = await runOnchainos(["wallet", "status"], {
    allowFailure: true,
    echo: false,
    timeoutMs: 30_000,
  });

  return {
    loggedIn: Boolean(
      findDeepValue(result.json, ["loggedIn", "logged_in"]),
    ),
    result,
  };
}

async function login() {
  const existing = await walletStatus();

  if (existing.loggedIn) {
    report.wallet.reusedExistingLogin = true;
    report.wallet.status = existing.result.json;
    console.log("Agentic Wallet is already logged in.");
    return;
  }

  const init = await runOnchainos(
    ["wallet", "login", "--phase", "init"],
    {
      echo: false,
      timeoutMs: 60_000,
    },
  );

  const loginUrl = findDeepValue(init.json, [
    "loginUrl",
    "login_url",
  ]);
  const sessionId = findDeepValue(init.json, [
    "authSessionId",
    "sessionId",
    "auth_session_id",
  ]);

  if (!loginUrl || !sessionId) {
    throw new Error(
      `Wallet login init did not return loginUrl and authSessionId.\n${init.combined}`,
    );
  }

  console.log("\nOpen this login URL:\n");
  console.log(String(loginUrl));
  console.log("");

  if (CONFIG.openLoginUrl) {
    await runOnchainos(
      ["wallet", "login", "--phase", "open", "--url", String(loginUrl)],
      {
        allowFailure: true,
        echo: false,
        timeoutMs: 30_000,
      },
    );
  }

  const poll = await runOnchainos(
    [
      "wallet",
      "login",
      "--phase",
      "poll",
      "--session-id",
      String(sessionId),
    ],
    {
      allowFailure: true,
      echo: true,
      timeoutMs: CONFIG.loginTimeoutMs,
    },
  );

  const persisted = await walletStatus();

  if (!persisted.loggedIn) {
    throw new Error(
      `Wallet login did not complete.\n${poll.combined}\n${persisted.result.combined}`,
    );
  }

  loggedInByScript = true;
  report.wallet.login = poll.json;
  report.wallet.statusAfterLogin = persisted.result.json;
  console.log("Wallet login completed.");
}

async function startA2aDaemon() {
  if (!CONFIG.startA2a || !okxA2aBin) return;

  const logPath = join(RUNTIME_DIR, "okx-a2a.log");
  const logFd = openSync(logPath, "a");

  a2aProcess = spawn(okxA2aBin, ["run"], {
    cwd: PROJECT_ROOT,
    env: process.env,
    detached: !IS_WINDOWS,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", logFd, logFd],
  });

  closeSync(logFd);
  report.cli.okxA2aLog = logPath;
  report.cli.okxA2aPid = a2aProcess.pid;

  await sleep(2_000);

  if (a2aProcess.exitCode !== null) {
    report.warnings.push(
      `okx-a2a exited immediately with code ${a2aProcess.exitCode}.`,
    );
    a2aProcess = null;
    console.warn("okx-a2a did not remain running; continuing.");
    return;
  }

  console.log(`okx-a2a started. Log: ${logPath}`);
}

function findUserAgentId(value) {
  for (const object of collectObjects(value)) {
    if (Array.isArray(object)) continue;

    const role = String(
      object.role ?? object.agentRole ?? "",
    ).toLowerCase();

    const id =
      object.agentId ??
      object.agentID ??
      object.agent_id ??
      null;

    if (
      id !== null &&
      (!role || role === "user" || role === "1")
    ) {
      return String(id);
    }
  }

  return extractAgentId(value);
}

async function getExistingUserAgent() {
  const attempts = [
    ["agent", "get-my-agents", "--role", "user", "--page", "1", "--page-size", "20"],
    ["agent", "my-agents", "--role", "user"],
  ];

  for (const args of attempts) {
    const result = await runOnchainos(args, {
      allowFailure: true,
      echo: false,
      timeoutMs: 60_000,
    });

    const id = result.code === 0 ? findUserAgentId(result.json) : null;
    if (id) return { id, result };
  }

  return { id: null, result: null };
}

async function ensureUserAgent() {
  const existing = await getExistingUserAgent();

  if (existing.id) {
    report.userAgent.id = existing.id;
    report.userAgent.reused = true;
    console.log(`Using existing User Agent: ${existing.id}`);
    return existing.id;
  }

  let precheck = await runOnchainos(
    ["agent", "pre-check", "--role", "user"],
    {
      echo: false,
      timeoutMs: 60_000,
    },
  );

  let data = precheck.json;
  const existingId = findUserAgentId(data);
  if (existingId) {
    report.userAgent.id = existingId;
    report.userAgent.reused = true;
    return existingId;
  }

  const consentKey = findDeepValue(data, [
    "consentKey",
    "consent_key",
  ]);

  if (consentKey) {
    const terms = findDeepValue(data, ["terms"]);
    console.log("\nOnchain OS registration terms:\n");
    console.log(
      typeof terms === "string"
        ? terms
        : JSON.stringify(terms, null, 2),
    );
    console.log("");

    const agreed = await confirmExact(
      "Accept the marketplace registration terms?",
      "AGREE",
    );
    if (!agreed) throw new Error("Registration terms were not accepted.");

    precheck = await runOnchainos(
      [
        "agent",
        "pre-check",
        "--role",
        "user",
        "--consent-key",
        String(consentKey),
      ],
      {
        echo: false,
        timeoutMs: 60_000,
      },
    );

    data = precheck.json;
  }

  const canCreate = findDeepValue(data, ["canCreate"]);
  if (canCreate !== true && String(canCreate) !== "true") {
    throw new Error(
      `User Agent cannot be created: ${
        findDeepValue(data, ["reason"]) || precheck.combined
      }`,
    );
  }

  let name = CONFIG.agentName;
  if (!name) name = await prompt("Enter a name for this User Agent: ");
  if (!name) throw new Error("Agent name cannot be empty.");

  const created = await runOnchainos(
    [
      "agent",
      "create",
      "--name",
      name,
      "--role",
      "user",
      "--description",
      CONFIG.agentDescription,
    ],
    {
      timeoutMs: 180_000,
    },
  );

  let id = extractAgentId(created.json);

  for (let attempt = 0; !id && attempt < 30; attempt += 1) {
    await sleep(2_000);
    id = (await getExistingUserAgent()).id;
  }

  if (!id) {
    throw new Error(
      `Agent creation completed but no agentId was found.\n${created.combined}`,
    );
  }

  report.userAgent.id = id;
  report.userAgent.reused = false;
  report.userAgent.name = name;
  console.log(`Created User Agent: ${id}`);
  return id;
}

function findServiceByEndpoint(value, endpoint) {
  const normalized = endpoint.replace(/\/+$/, "");

  for (const object of collectObjects(value)) {
    if (Array.isArray(object)) continue;

    const candidate = String(
      object.endpoint ??
        object.serviceEndpoint ??
        object.url ??
        "",
    ).replace(/\/+$/, "");

    if (candidate !== normalized) continue;

    const id =
      object.id ??
      object.serviceId ??
      object.serviceID ??
      object.service_id;

    if (id) return String(id);
  }

  return null;
}

async function resolveServiceIds() {
  const result = await runOnchainos(
    ["agent", "service-list", "--agent-id", CONFIG.providerId],
    {
      allowFailure: true,
      echo: false,
      timeoutMs: 60_000,
    },
  );

  for (const name of CONFIG.servicesToRun) {
    const service = SERVICES[name];
    const live =
      result.code === 0
        ? findServiceByEndpoint(result.json, service.endpoint)
        : null;

    service.serviceId = live || service.configuredServiceId;

    report.serviceResolution[name] = {
      endpoint: service.endpoint,
      serviceId: service.serviceId,
      source: live ? "live service-list" : "configured fallback",
    };
  }
}

function decodePaymentRequired(encoded) {
  const normalized = String(encoded)
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(String(encoded).length / 4) * 4, "=");

  const decoded = Buffer.from(normalized, "base64").toString("utf8");
  return JSON.parse(decoded);
}

async function fetchLiveChallenge(name, service) {
  const response = await fetch(service.endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(service.body),
    signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
  });

  const responseText = await response.text();
  const encoded =
    response.headers.get("payment-required") ||
    response.headers.get("PAYMENT-REQUIRED");

  if (response.status !== 402 || !encoded) {
    throw new Error(
      `${name} did not return PAYMENT-REQUIRED. HTTP ${response.status}: ${responseText.slice(0, 1000)}`,
    );
  }

  const challenge = decodePaymentRequired(encoded);

  if (
    Number(challenge.x402Version) !== 2 ||
    !challenge.resource ||
    !Array.isArray(challenge.accepts)
  ) {
    throw new Error(
      `${name} returned an unsupported or incomplete x402 challenge.`,
    );
  }

  const acceptedIndex = challenge.accepts.findIndex(
    (entry) =>
      String(entry.scheme).toLowerCase() === "exact" &&
      String(entry.network).toLowerCase() ===
        CONFIG.network.toLowerCase() &&
      normalizeAddress(entry.asset) ===
        normalizeAddress(CONFIG.tokenAddress) &&
      normalizeAddress(entry.payTo) ===
        normalizeAddress(CONFIG.payTo) &&
      String(entry.amount) === String(service.amountAtomic),
  );

  if (acceptedIndex < 0) {
    throw new Error(
      `${name} live challenge does not exactly match the expected network, token, recipient, and amount.`,
    );
  }

  return {
    encoded,
    challenge,
    acceptedIndex,
    accepted: challenge.accepts[acceptedIndex],
    unpaidBody: responseText,
  };
}

async function getTokenBalanceAtomic() {
  const result = await runOnchainos(
    [
      "wallet",
      "balance",
      "--chain",
      CONFIG.chainId,
      "--token-address",
      CONFIG.tokenAddress,
      "--force",
    ],
    {
      echo: false,
      timeoutMs: 90_000,
    },
  );

  let rawBalance = null;
  let balance = null;
  let decimals = null;

  for (const object of collectObjects(result.json)) {
    if (Array.isArray(object)) continue;

    if (
      normalizeAddress(object.tokenAddress) ===
      normalizeAddress(CONFIG.tokenAddress)
    ) {
      rawBalance = object.rawBalance ?? rawBalance;
      balance = object.balance ?? balance;
      decimals = object.decimal ?? decimals;
    }
  }

  if (rawBalance === null || rawBalance === undefined) {
    throw new Error(
      `Could not find USD₮0 balance for ${CONFIG.tokenAddress}.`,
    );
  }

  return {
    raw: BigInt(String(rawBalance)),
    display: String(balance ?? rawBalance),
    decimals: String(decimals ?? "6"),
    output: result.json,
  };
}

async function checkTotalBalance(challenges) {
  const required = challenges.reduce(
    (sum, entry) => sum + BigInt(entry.service.amountAtomic),
    0n,
  );

  const balance = await getTokenBalanceAtomic();

  report.wallet.balanceBefore = {
    raw: balance.raw.toString(),
    display: balance.display,
    requiredRaw: required.toString(),
  };

  if (balance.raw < required) {
    throw new Error(
      `Insufficient USD₮0 for the selected services. Balance: ${balance.display}; required atomic amount: ${required}. No tasks or payments were created.`,
    );
  }

  console.log(
    `USD₮0 balance preflight passed: ${balance.display} available for ${CONFIG.servicesToRun.length} service(s).`,
  );
}

async function taskStatus(jobId, userAgentId) {
  const result = await runOnchainos(
    ["agent", "status", jobId, "--agent-id", userAgentId],
    {
      allowFailure: true,
      echo: false,
      timeoutMs: 60_000,
    },
  );

  return {
    status: normalizeStatus(result.json, result.combined),
    result,
  };
}

async function waitForStatus(
  jobId,
  userAgentId,
  wanted,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  let last = null;

  while (Date.now() < deadline && !interrupted) {
    last = await taskStatus(jobId, userAgentId);

    if (last.status && wanted.includes(last.status)) {
      return last;
    }

    await sleep(CONFIG.pollMs);
  }

  return last;
}

async function createMarketplaceTask(service, userAgentId) {
  const created = await runOnchainos(
    [
      "agent",
      "create-task",
      "--title",
      service.title,
      "--description",
      service.description,
      "--description-summary",
      service.summary,
      "--budget",
      service.fee,
      "--max-budget",
      service.fee,
      "--currency",
      "USDT",
      "--provider",
      CONFIG.providerId,
      "--endpoint",
      service.endpoint,
      "--payment-mode",
      "x402",
      "--service-id",
      service.serviceId,
      "--service-token-address",
      CONFIG.tokenAddress,
      "--service-token-amount",
      service.fee,
    ],
    {
      timeoutMs: 180_000,
    },
  );

  const jobId = extractJobId(created.json, created.combined);
  if (!jobId) {
    throw new Error(
      `create-task returned no jobId.\n${created.combined}`,
    );
  }

  const visible = await waitForStatus(
    jobId,
    userAgentId,
    [
      "created",
      "accepted",
      "submitted",
      "complete",
      "closed",
      "expired",
      "rejected",
    ],
    CONFIG.taskVisibleTimeoutMs,
  );

  if (!visible?.status) {
    throw new Error(
      `Task ${jobId} was broadcast but did not become queryable. Payment was not attempted.`,
    );
  }

  if (
    ["closed", "expired", "rejected"].includes(visible.status)
  ) {
    throw new Error(
      `Task ${jobId} entered terminal status ${visible.status} before payment.`,
    );
  }

  return {
    jobId,
    createOutput: created.json,
    createTxHash: extractTxHash(created.json, created.combined),
    initialStatus: visible.status,
  };
}

async function signFullChallenge(challenge) {
  const signed = await runOnchainos(
    [
      "payment",
      "pay",
      "--payload",
      challenge.encoded,
      "--selected-index",
      String(challenge.acceptedIndex),
    ],
    {
      timeoutMs: 180_000,
    },
  );

  const data = unwrapData(signed.json);
  const headerName = findDeepValue(data, [
    "header_name",
    "headerName",
  ]);
  const headerValue = findDeepValue(data, [
    "authorization_header",
    "authorizationHeader",
  ]);

  if (!headerName || !headerValue) {
    throw new Error(
      `Onchain OS did not return the assembled payment header. The paid request was not sent.\n${signed.combined}`,
    );
  }

  return {
    headerName: String(headerName),
    headerValue: String(headerValue),
    scheme: findDeepValue(data, ["scheme"]),
    wallet: findDeepValue(data, ["wallet"]),
  };
}

async function replayPaidRequestOnce(service, signed) {
  const response = await fetch(service.endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [signed.headerName]: signed.headerValue,
    },
    body: JSON.stringify(service.body),
    signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
  });

  const responseText = await response.text();
  const paymentResponse =
    response.headers.get("payment-response") ||
    response.headers.get("PAYMENT-RESPONSE");

  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    body = { raw: responseText };
  }

  return {
    httpStatus: response.status,
    ok: response.ok,
    body,
    paymentResponse: paymentResponse || null,
  };
}

async function saveDeliverable(
  serviceName,
  service,
  jobId,
  replay,
) {
  const file = join(
    RUNTIME_DIR,
    `${serviceName}-${jobId.slice(2, 12)}-deliverable.json`,
  );

  writeFileSync(
    file,
    JSON.stringify(
      {
        service: serviceName,
        endpoint: service.endpoint,
        receivedAt: new Date().toISOString(),
        paymentResponsePresent: Boolean(replay.paymentResponse),
        result: replay.body,
      },
      null,
      2,
    ),
    "utf8",
  );

  const saved = await runOnchainos(
    [
      "agent",
      "task-deliverable-save",
      "--job-id",
      jobId,
      "--role",
      "user",
      "--file",
      file,
      "--deliverable-type",
      "text",
      "--title",
      service.title,
      "--short-id",
      jobId.slice(0, 10),
      "--token-symbol",
      CONFIG.cliTokenSymbol,
      "--token-amount",
      service.fee,
      "--counterparty-agent-id",
      CONFIG.providerId,
      "--counterparty-name",
      "PULSE",
    ],
    {
      timeoutMs: 60_000,
    },
  );

  const savedPath = findDeepValue(saved.json, ["path"]);
  if (!savedPath) {
    throw new Error(
      `The genuine service response was received, but its deliverable could not be saved.\n${saved.combined}`,
    );
  }

  return String(savedPath);
}

async function directAcceptAfterDelivery(
  service,
  jobId,
  userAgentId,
) {
  let current = await taskStatus(jobId, userAgentId);

  if (
    ["accepted", "submitted", "complete"].includes(current.status)
  ) {
    return current.status;
  }

  let lastError = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await runOnchainos(
      [
        "agent",
        "direct-accept",
        jobId,
        "--provider-agent-id",
        CONFIG.providerId,
        "--token-symbol",
        CONFIG.cliTokenSymbol,
        "--token-amount",
        service.fee,
      ],
      {
        allowFailure: true,
        echo: true,
        timeoutMs: 180_000,
      },
    );

    if (result.code === 0) {
      const txHash = extractTxHash(result.json, result.combined);

      const observed = await waitForStatus(
        jobId,
        userAgentId,
        ["accepted", "submitted", "complete"],
        CONFIG.lifecycleTimeoutMs,
      );

      if (observed?.status) return observed.status;

      throw new Error(
        `direct-accept${txHash ? ` (${txHash})` : ""} was submitted, but task ${jobId} did not reach accepted status. Do not pay again.`,
      );
    }

    lastError = result.combined;

    current = await taskStatus(jobId, userAgentId);
    if (
      ["accepted", "submitted", "complete"].includes(current.status)
    ) {
      return current.status;
    }

    if (attempt < 5) await sleep(10_000);
  }

  throw new Error(
    `The service was delivered and saved, but direct-accept failed after five non-broadcast attempts. Do not pay again.\n${lastError || ""}`,
  );
}

async function completeTask(jobId, userAgentId) {
  const current = await taskStatus(jobId, userAgentId);

  if (current.status === "complete") return "complete";

  if (
    current.status !== "accepted" &&
    current.status !== "submitted"
  ) {
    throw new Error(
      `Task ${jobId} cannot be completed from status ${current.status || "unknown"}.`,
    );
  }

  await runOnchainos(["agent", "complete", jobId], {
    timeoutMs: 180_000,
  });

  const completed = await waitForStatus(
    jobId,
    userAgentId,
    ["complete"],
    CONFIG.lifecycleTimeoutMs,
  );

  if (completed?.status !== "complete") {
    throw new Error(
      `Task ${jobId} did not reach complete after the completion transaction.`,
    );
  }

  return "complete";
}

async function promptForFeedback(
  serviceName,
  jobId,
  userAgentId,
) {
  if (!CONFIG.enableFeedback) {
    return {
      submitted: false,
      reason: "ENABLE_FEEDBACK is disabled",
    };
  }

  const review = await confirmExact(
    `Task ${jobId} is complete. Submit honest feedback for ${serviceName}?`,
    "REVIEW",
  );

  if (!review) {
    return { submitted: false, reason: "user skipped" };
  }

  let score = null;

  while (score === null) {
    const raw = await prompt("Score from 0.00 to 5.00: ");
    const value = Number(raw);

    if (
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 5 &&
      /^\d(?:\.\d{1,2})?$/.test(raw)
    ) {
      score = value.toFixed(2);
    } else {
      console.log("Enter a number from 0.00 to 5.00.");
    }
  }

  const description = await prompt(
    "Describe your actual experience: ",
  );

  if (!description) {
    throw new Error("Feedback text cannot be empty.");
  }

  const submitted = await runOnchainos(
    [
      "agent",
      "feedback-submit",
      "--agent-id",
      CONFIG.providerId,
      "--creator-id",
      userAgentId,
      "--task-id",
      jobId,
      "--score",
      score,
      "--description",
      description,
    ],
    {
      timeoutMs: 180_000,
    },
  );

  return {
    submitted: true,
    score,
    txHash: extractTxHash(
      submitted.json,
      submitted.combined,
    ),
  };
}

async function runService(
  name,
  service,
  challenge,
  userAgentId,
) {
  const taskReport = {
    service: name,
    endpoint: service.endpoint,
    fee: service.fee,
    amountAtomic: service.amountAtomic,
    serviceId: service.serviceId,
    jobId: null,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  report.tasks.push(taskReport);
  writeReport();

  try {
    console.log(`\n=== ${name.toUpperCase()} ===`);
    console.log("Full live PAYMENT-REQUIRED challenge validated.");

    if (CONFIG.dryRun) {
      taskReport.status = "validated_dry_run";
      taskReport.finishedAt = new Date().toISOString();
      writeReport();
      console.log(`=== ${name} VALIDATED — NO PAYMENT ===`);
      return;
    }

    const remaining = await getTokenBalanceAtomic();

    if (remaining.raw < BigInt(service.amountAtomic)) {
      throw new Error(
        `Insufficient USD₮0 before ${name}. Balance: ${remaining.display}; required: ${service.fee}. No task was created.`,
      );
    }

    const created = await createMarketplaceTask(
      service,
      userAgentId,
    );

    taskReport.jobId = created.jobId;
    taskReport.createTxHash = created.createTxHash;
    taskReport.initialStatus = created.initialStatus;
    writeReport();

    console.log(`${name} jobId: ${created.jobId}`);

    const approved = await confirmExact(
      `Authorize exactly ${service.fee} USD₮0 for ${name.toUpperCase()}?`,
      "PAY",
    );

    if (!approved) {
      throw new Error(
        `Payment was not approved. Task ${created.jobId} remains unpaid.`,
      );
    }

    const signed = await signFullChallenge(challenge);

    taskReport.paymentHeader = {
      name: signed.headerName,
      scheme: signed.scheme || null,
      wallet: signed.wallet || null,
      fullChallengePreserved: true,
    };
    writeReport();

    console.log(
      "Payment authorization signed. Replaying the paid request exactly once.",
    );

    const replay = await replayPaidRequestOnce(service, signed);

    taskReport.replay = {
      httpStatus: replay.httpStatus,
      success: replay.ok,
      paymentResponsePresent: Boolean(replay.paymentResponse),
      body: replay.body,
    };
    writeReport();

    if (!replay.ok) {
      throw new Error(
        `Paid replay returned HTTP ${replay.httpStatus}. It will NOT be retried automatically because funds may already have moved. Task: ${created.jobId}`,
      );
    }

    if (!replay.paymentResponse) {
      throw new Error(
        `Service returned HTTP ${replay.httpStatus}, but PAYMENT-RESPONSE was missing. The result is recorded, but the script will not complete or review the task automatically.`,
      );
    }

    const deliverablePath = await saveDeliverable(
      name,
      service,
      created.jobId,
      replay,
    );

    taskReport.deliverablePath = deliverablePath;
    writeReport();

    const acceptedStatus = await directAcceptAfterDelivery(
      service,
      created.jobId,
      userAgentId,
    );

    taskReport.acceptedStatus = acceptedStatus;
    writeReport();

    taskReport.finalStatus = await completeTask(
      created.jobId,
      userAgentId,
    );

    taskReport.feedback = await promptForFeedback(
      name,
      created.jobId,
      userAgentId,
    );

    taskReport.status = "completed";
    taskReport.finishedAt = new Date().toISOString();
    writeReport();

    console.log(`=== ${name} COMPLETED ===`);
  } catch (error) {
    taskReport.status = "failed";
    taskReport.error =
      error instanceof Error ? error.message : String(error);
    taskReport.finishedAt = new Date().toISOString();

    report.errors.push({
      service: name,
      jobId: taskReport.jobId,
      error: taskReport.error,
    });

    writeReport();

    console.error(
      `=== ${name} FAILED ===\n${taskReport.error}`,
    );
  }
}

async function cleanup() {
  if (a2aProcess && CONFIG.stopA2aOnExit) {
    try {
      if (IS_WINDOWS) {
        spawnSync(
          "taskkill",
          ["/PID", String(a2aProcess.pid), "/T", "/F"],
          { windowsHide: true },
        );
      } else {
        a2aProcess.kill("SIGTERM");
      }
    } catch {
      // Best effort.
    }
    a2aProcess = null;
  }

  if (
    CONFIG.logoutOnExit &&
    loggedInByScript &&
    onchainosBin
  ) {
    await runOnchainos(["wallet", "logout"], {
      allowFailure: true,
      echo: false,
      timeoutMs: 30_000,
    });
    report.wallet.loggedOut = true;
  }
}

process.on("SIGINT", () => {
  interrupted = true;
  console.warn("\nInterrupted. No paid replay will be retried.");
});

async function main() {
  console.log("=== PULSE Full-Payload Safe Review Runner ===");
  console.log(
    CONFIG.dryRun
      ? "DRY_RUN is enabled: no tasks, signatures, payments, or reviews will be created."
      : "LIVE MODE: every payment requires typing PAY.",
  );

  await verifyCli();
  await login();
  await startA2aDaemon();

  const userAgentId = await ensureUserAgent();
  await resolveServiceIds();

  const challenges = [];

  for (const name of CONFIG.servicesToRun) {
    const service = SERVICES[name];
    const challenge = await fetchLiveChallenge(name, service);

    challenges.push({
      name,
      service,
      challenge,
    });

    report.serviceResolution[name].liveChallenge = {
      x402Version: challenge.challenge.x402Version,
      resource: challenge.challenge.resource,
      selectedIndex: challenge.acceptedIndex,
      amount: challenge.accepted.amount,
      network: challenge.accepted.network,
      asset: challenge.accepted.asset,
      payTo: challenge.accepted.payTo,
    };
  }

  if (!CONFIG.dryRun) {
    await checkTotalBalance(challenges);
  }

  for (const entry of challenges) {
    if (interrupted) break;
    await runService(
      entry.name,
      entry.service,
      entry.challenge,
      userAgentId,
    );
  }

  const completed = report.tasks.filter(
    (task) => task.status === "completed",
  ).length;
  const failed = report.tasks.filter(
    (task) => task.status === "failed",
  ).length;

  report.finishedAt = new Date().toISOString();
  report.status = interrupted
    ? "interrupted"
    : failed
      ? "completed_with_failures"
      : CONFIG.dryRun
        ? "validated_dry_run"
        : "completed";

  writeReport();

  console.log("\nFINAL SUMMARY");
  console.log(`Services requested: ${report.tasks.length}`);
  console.log(`Services completed: ${completed}`);
  console.log(`Services failed:    ${failed}`);
  console.log(`Report:             ${CONFIG.reportPath}`);

  if (failed) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof Error ? error.message : String(error);

  report.status = "failed";
  report.finishedAt = new Date().toISOString();
  report.errors.push({ stage: "main", error: message });
  writeReport();

  console.error(`\nERROR: ${message}`);
  process.exitCode = 1;
} finally {
  await cleanup();
  writeReport();
  rl.close();
}

import { readFileSync } from "node:fs";

// Railway's Redis Docker service does not contain this repository. Paste this
// generated inline command into that service's Start Command, not the API's.
const script = readFileSync(new URL("./railway-redis-start.sh", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const startCommand = "/bin/sh -ec " + quote(script);
console.log(process.argv.includes("--json") ? JSON.stringify({ startCommand }) : startCommand);

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { splitCloudEnv, serializeCloudEnv, parseCloudEnv, prepareCloudRelease } from "./cloud-env.mjs";
const root = process.cwd();

const template = parseCloudEnv(readFileSync(resolve(root, ".env.example"), "utf8"));
const local = parseCloudEnv(readFileSync(resolve(root, ".env"), "utf8"));
const args = process.argv.slice(2);
for (const arg of args) {
  if (arg !== "--production" && !arg.startsWith("--api-origin=")) throw new Error(`Unknown option: ${arg}`);
}
const { railway, vercel } = prepareCloudRelease(splitCloudEnv(template, local), {
  production: args.includes("--production"),
  apiOrigin: args.find((arg) => arg.startsWith("--api-origin="))?.slice("--api-origin=".length),
});
writeFileSync(resolve(root, ".env.railway.cloud"), serializeCloudEnv(railway, "Railway"), { encoding: "utf8", mode: 0o600 });
writeFileSync(resolve(root, ".env.vercel.cloud"), serializeCloudEnv(vercel, "Vercel"), { encoding: "utf8", mode: 0o600 });
console.log(`Created .env.railway.cloud (${railway.size} server settings) and .env.vercel.cloud (${vercel.size} public browser settings).`);
console.log("Review production API/web origins, then import each file into its named host only.");
console.log("Excluded test-wallet keys and operator-only live-payment controls.");
console.log("An executor key matching the qualification signer is omitted; configure a dedicated production signer before activation.");
console.log("Repeated-character report encryption fixtures are omitted; preserve a secure existing production report key.");
console.log("Empty settings are omitted; existing changed Arc settings are included. Existing .env.cloud is preserved.");

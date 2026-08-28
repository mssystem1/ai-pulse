import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import solc from "solc";

const root = resolve(import.meta.dirname, "..");
const contractDir = resolve(root, "contracts");
const files = (await readdir(contractDir)).filter((name) => name.endsWith(".sol"));
const sources = Object.fromEntries(await Promise.all(files.map(async (name) => [name, { content: await readFile(resolve(contractDir, name), "utf8") }])));
const input = { language: "Solidity", sources, settings: { viaIR: true, evmVersion: "shanghai", optimizer: { enabled: true, runs: 500 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((entry) => entry.severity === "error");
if (errors.length) { for (const error of output.errors) console.error(error.formattedMessage); process.exit(1); }
const artifacts = resolve(root, "artifacts"); await mkdir(artifacts, { recursive: true });
await writeFile(resolve(artifacts, "standard-input.json"), JSON.stringify(input, null, 2));
await writeFile(resolve(artifacts, "compiler-version.txt"), solc.version().replace(/\.Emscripten\.clang.*$/, ""));
for (const [source, contracts] of Object.entries(output.contracts)) for (const [name, artifact] of Object.entries(contracts)) await writeFile(resolve(artifacts, `${name}.json`), JSON.stringify({ contractName: name, sourceName: basename(source), abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`, metadata: artifact.metadata }, null, 2));
console.log(`Compiled ${Object.values(output.contracts).reduce((sum, group) => sum + Object.keys(group).length, 0)} contracts with solc ${solc.version()}`);

import { readFile, writeFile } from "node:fs/promises";

// Keep the published SDK self-contained: its build must not import workspace source.
const source = await readFile(
  new URL("../packages/contracts/src/types.ts", import.meta.url),
  "utf8",
);
const output = new URL("../packages/sdk/src/types.ts", import.meta.url);
const generated =
  "// Generated from packages/contracts/src/types.ts. Run scripts/sync-contract-types.ts.\n" +
  source;
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")) !== generated)
    throw new Error("SDK types drifted; run scripts/sync-contract-types.ts");
} else await writeFile(output, generated);

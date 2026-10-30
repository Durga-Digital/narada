import { readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const source = fileURLToPath(
  import.meta.resolve("@datar-platform/better-auth-dynamodb"),
);
const code = await readFile(source);
// This checksum is the reviewed 0.2.2 distribution after the repository patch.
// Never ship the upstream adapter accidentally: OAuth rotation depends on it.
if (
  createHash("sha256").update(code).digest("hex") !==
  "4357e93ce33e1cf43bf2aaeb71ba04d488df3fe8d58a30930a7a134e5b34e7a0"
)
  throw new Error(
    "The auth adapter patch changed or is missing; review it and rerun OAuth concurrency tests before updating this checksum",
  );
if (/from ["']\.\.?\//.test(code.toString()))
  throw new Error("Adapter distribution is no longer standalone");
await writeFile(new URL("./dist/auth-database.js", import.meta.url), code);
await copyFile(
  resolve(dirname(source), "index.d.ts"),
  new URL("./dist/auth-database.d.ts", import.meta.url),
);
const license = await readFile(resolve(dirname(source), "../LICENSE"), "utf8");
await writeFile(
  new URL("./dist/THIRD-PARTY-LICENSES.txt", import.meta.url),
  "@datar-platform/better-auth-dynamodb 0.2.2, with Narada's OAuth predicate/rotation patch.\nSource: https://github.com/datar-platform/better-auth-dynamodb\n\n" +
    license,
);

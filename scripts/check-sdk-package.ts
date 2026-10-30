import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const root = process.cwd();
const sdk = resolve(root, "packages/sdk");
const output = resolve(root, ".local/sdk-release");
const manifest = JSON.parse(await readFile(join(sdk, "package.json"), "utf8"));
assert.equal(manifest.name, "@durgadigital/narada");
assert.equal(manifest.license, "Apache-2.0");
const license = await readFile(join(root, "LICENSE"), "utf8");
const notice = await readFile(join(root, "NOTICE"), "utf8");
assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
assert.equal(await readFile(join(sdk, "LICENSE"), "utf8"), license);
assert.equal(await readFile(join(sdk, "NOTICE"), "utf8"), notice);
assert.notEqual(manifest.private, true);
assert.equal(manifest.publishConfig.access, "public");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
// Tag and manual releases must agree with the version reviewed in source control.
if (process.env.RELEASE_VERSION)
  assert.equal(
    process.env.RELEASE_VERSION,
    manifest.version,
    "Release version differs from package.json",
  );
if (process.env.GITHUB_REF_TYPE === "tag")
  assert.equal(
    process.env.GITHUB_REF_NAME,
    `sdk-v${manifest.version}`,
    "SDK tag differs from package.json",
  );
await mkdir(output, { recursive: true });
const [packed] = JSON.parse(
  execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", output],
    { cwd: sdk, encoding: "utf8" },
  ),
);
assert.deepEqual(
  packed.files.map((file: { path: string }) => file.path).sort(),
  [
    "LICENSE",
    "NOTICE",
    "README.md",
    "dist/index.d.ts",
    "dist/index.js",
    "dist/types.d.ts",
    "dist/types.js",
    "package.json",
  ].sort(),
  "The public archive must contain only the SDK, declarations, README, license, notice, and manifest",
);
const archive = join(output, packed.filename);
const consumer = await mkdtemp(join(tmpdir(), "narada-sdk-consumer-"));
try {
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    [
      "install",
      archive,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
    ],
    { cwd: consumer, stdio: "pipe" },
  );
  const installed = join(consumer, "node_modules/@durgadigital/narada");
  assert.equal(await readFile(join(installed, "LICENSE"), "utf8"), license);
  assert.equal(await readFile(join(installed, "NOTICE"), "utf8"), notice);
  await writeFile(
    join(consumer, "smoke.mjs"),
    `
import assert from 'node:assert/strict';
import { Narada, NaradaError } from '@durgadigital/narada';
assert.equal(typeof NaradaError, 'function');
let called = false;
const client = new Narada({ apiKey: 'na_pack_test', baseUrl: 'https://example.test', fetch: async (url, init) => {
  called = true;
  assert.equal(url, 'https://example.test/api/v1/emails');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer na_pack_test');
  assert.equal(init.headers['idempotency-key'], 'pack-test');
  return new Response(JSON.stringify({ id: 'test-message' }), {status: 200});
}});
assert.deepEqual(await client.emails.send({from:'a@example.test',to:'b@example.test',subject:'Package test',text:'Hello'}, {idempotencyKey:'pack-test'}), {id:'test-message'});
assert(called);
`,
  );
  execFileSync(process.execPath, ["smoke.mjs"], {
    cwd: consumer,
    stdio: "inherit",
  });
  await writeFile(
    join(consumer, "types.ts"),
    `import { Narada, type NaradaOptions } from '@durgadigital/narada';\nconst options: NaradaOptions = { apiKey: 'na_type_test', baseUrl: 'https://example.test' };\nconst client = new Narada(options);\nvoid client.contacts.list({ limit: 10 });\n`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        types: [],
      },
      include: ["types.ts"],
    }),
  );
  execFileSync(
    resolve(root, "node_modules/.bin/tsc"),
    ["-p", "tsconfig.json"],
    { cwd: consumer, stdio: "inherit" },
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}
console.log(
  `Verified ${manifest.name}@${manifest.version}: archive allowlist, isolated ESM import, transport, and TypeScript declarations.`,
);
if (process.env.GITHUB_OUTPUT)
  await writeFile(
    process.env.GITHUB_OUTPUT,
    `archive=${archive}\nversion=${manifest.version}\n`,
    { flag: "a" },
  );

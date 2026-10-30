import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

const mode = process.argv[2];
assert(
  mode === "before" || mode === "after",
  "Choose before or after publication",
);
const manifest = JSON.parse(
  await readFile("packages/sdk/package.json", "utf8"),
);
assert.equal(manifest.name, "@durgadigital/narada");
assert(process.env.SDK_ARCHIVE, "SDK_ARCHIVE must identify the tested tarball");
const integrity = `sha512-${createHash("sha512")
  .update(await readFile(process.env.SDK_ARCHIVE))
  .digest("base64")}`;
const url = `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${encodeURIComponent(manifest.version)}`;
const attempts = mode === "after" ? 30 : 1;
for (let attempt = 1; attempt <= attempts; attempt++) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "cache-control": "no-cache" },
  });
  if (response.ok) {
    const published = await response.json();
    assert.equal(published.version, manifest.version);
    assert.equal(
      published.dist?.integrity,
      integrity,
      "This version already exists with different contents; choose a new version",
    );
    console.log(
      `Verified public ${manifest.name}@${manifest.version}: registry integrity matches the tested archive.`,
    );
    if (mode === "before" && process.env.GITHUB_OUTPUT)
      await writeFile(process.env.GITHUB_OUTPUT, "publish=false\n", {
        flag: "a",
      });
    process.exit(0);
  }
  if (response.status === 404 && mode === "before") {
    assert(
      process.env.GITHUB_OUTPUT,
      "GITHUB_OUTPUT is required for publication preflight",
    );
    await writeFile(process.env.GITHUB_OUTPUT, "publish=true\n", { flag: "a" });
    process.exit(0);
  }
  assert(
    response.status === 404 ||
      response.status >= 500 ||
      response.status === 429,
    `Registry returned HTTP ${response.status}`,
  );
  if (attempt < attempts) {
    console.log(
      `Waiting for npm registry availability (${attempt}/${attempts})…`,
    );
    await setTimeout(10000);
  }
}
throw new Error(
  "Registry verification timed out. The upload may have succeeded; inspect npm before retrying. Do not change the version merely to bypass propagation delay.",
);

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = process.cwd();
const consumer = await mkdtemp(join(tmpdir(), "narada-backend-consumer-"));
const directories = [
  "packages/contracts",
  "packages/core",
  "packages/runtime-aws",
  "packages/mcp",
  "packages/http-api",
  "apps/api",
  "apps/worker",
];
try {
  const dependencies: Record<string, string> = {};
  const publicModules: string[] = [];
  for (const directory of directories) {
    const manifest = JSON.parse(
      await readFile(join(root, directory, "package.json"), "utf8"),
    );
    const archive = join(
      consumer,
      manifest.name.replace("@", "").replace("/", "-") + ".tgz",
    );
    execFileSync("pnpm", ["pack", "--out", archive], {
      cwd: join(root, directory),
      stdio: "pipe",
    });
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
      .trim()
      .split("\n");
    assert(
      entries.every((entry) =>
        /^package\/(?:dist\/|package\.json$|README\.md$|LICENSE$)/.test(entry),
      ),
      `${manifest.name} contains unexpected files`,
    );
    const packedManifest = JSON.parse(
      execFileSync("tar", ["-xOf", archive, "package/package.json"], {
        encoding: "utf8",
      }),
    );
    assert.deepEqual(
      packedManifest.exports,
      manifest.publishConfig.exports,
      `${manifest.name}: packed exports must omit workspace-only source conditions`,
    );
    for (const [subpath, target] of Object.entries(packedManifest.exports) as [
      string,
      {
        default: string;
        types: string;
      },
    ][]) {
      publicModules.push(
        manifest.name + (subpath === "." ? "" : subpath.slice(1)),
      );
      assert(
        entries.includes("package/" + target.default.replace(/^\.\//, "")),
        `${manifest.name}: missing JS export`,
      );
      assert(
        entries.includes("package/" + target.types.replace(/^\.\//, "")),
        `${manifest.name}: missing declaration export`,
      );
    }
    dependencies[manifest.name] = `file:${archive}`;
  }
  const rootManifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies,
      devDependencies: {
        "@types/node": rootManifest.devDependencies["@types/node"],
      },
    }),
  );
  await writeFile(
    join(consumer, "pnpm-workspace.yaml"),
    JSON.stringify({ overrides: dependencies }),
  );
  // A normal consumer install has no repository paths, tsx, or root dependencies.
  execFileSync(
    "pnpm",
    [
      "install",
      "--prefer-offline",
      "--ignore-scripts",
      "--config.confirmModulesPurge=false",
    ],
    { cwd: consumer, stdio: "inherit" },
  );
  await writeFile(
    join(consumer, "smoke.mjs"),
    `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Application } from '@narada/core';
import { createRuntime, loadConfig } from '@narada/runtime-aws';
import { createPublicApi } from '@narada/http-api';
import { mcpInputSchema } from '@narada/mcp';
import { workHandler, eventHandler, runWorkers } from '@narada/worker';
import { startServer } from '@narada/api';
const runtime = createRuntime(loadConfig({BETTER_AUTH_SECRET:'x'.repeat(40)}));
Object.defineProperty(runtime,'auth',{get(){throw new Error('REST must not initialize auth')}});
assert.equal(typeof new Application(runtime).execute, 'function');
assert.equal(typeof workHandler, 'function');
assert.equal(typeof eventHandler, 'function');
assert.equal(typeof runWorkers, 'function');
assert(mcpInputSchema('contacts.list'));
const app = createPublicApi(runtime);
assert.equal((await app.request('/api/admin/keys')).status, 404);
const server = startServer(runtime, {port:0});
await new Promise(resolve => server.once('listening',resolve));
try {
 const response = await fetch('http://127.0.0.1:'+server.address().port+'/api/health');
 assert.deepEqual(await response.json(), {ok:true,mode:'local'});
} finally {await new Promise(resolve=>server.close(resolve));}
const patched = await readFile(new URL('./auth-database.js',import.meta.resolve('@narada/core')),'utf8');
assert(patched.includes('where = []'));
assert(patched.includes('expected == null ? actual == null'));
runtime.store.client.destroy(); runtime.queues.client.destroy();
`,
  );
  execFileSync(process.execPath, ["--conditions=development", "smoke.mjs"], {
    cwd: consumer,
    stdio: "inherit",
  });
  await writeFile(
    join(consumer, "types.ts"),
    `
import { Application, type Caller, type Runtime, type ExecutionResult, type AuthSession } from '@narada/core';
import type { OperationOutput } from '@narada/contracts';
import { createPublicApi } from '@narada/http-api';
import { startServer } from '@narada/api';
import { workHandler } from '@narada/worker';
declare const runtime: Runtime;
declare const caller: Caller;
const application = new Application(runtime);
const session: Promise<AuthSession | null> = runtime.auth.api.getSession({headers: new Headers()});
// @ts-expect-error Auth inputs remain typed, not erased to any.
runtime.auth.api.getSession({headers: 'invalid'});
// @ts-expect-error Provider configuration is not a public package contract.
import type * as InternalAuthOptions from '@narada/core/oauth-auth';
const typed: Promise<ExecutionResult<OperationOutput<'contacts.create'>>> = application.execute(caller, 'contacts.create', {body:{email:'a@example.test'}}, {idempotencyKey:'event-123'});
// @ts-expect-error Canonical required fields must survive the package boundary.
application.execute(caller, 'contacts.create', {body:{name:'missing email'}});
createPublicApi(runtime); startServer(runtime); void workHandler; void typed; void session;
${publicModules.map((name, i) => `import type * as PublicModule${i} from ${JSON.stringify(name)};`).join("\n")}
`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: ["node"],
      },
      include: ["types.ts"],
    }),
  );
  execFileSync(
    resolve(root, "node_modules/.bin/tsc"),
    ["-p", "tsconfig.json", "--pretty", "false"],
    { cwd: consumer, stdio: "inherit" },
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}
console.log(
  "Verified seven backend archives: isolated ESM/declarations, standalone HTTP, worker imports, and patched OAuth adapter.",
);

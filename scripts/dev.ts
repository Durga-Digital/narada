import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { initialize } from "./local.js";
const children: ChildProcess[] = [];
const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
if (!process.argv.includes("--no-containers"))
  await run("docker", ["compose", "up", "-d"]);
await initialize();
console.log(
  "\nNarada local environment\nDashboard: http://localhost:5173\nMail inbox: http://localhost:8025\nQueue console: http://localhost:9325\n",
);
try {
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  console.log(
    `Local owner: ${owner.email}\nLocal password: ${owner.password}\nThese credentials only exist in your local development database.\n`,
  );
} catch {}
for (const args of [
  ["exec", "tsx", "watch", "--conditions=development", "apps/api/src/local.ts"],
  [
    "exec",
    "tsx",
    "watch",
    "--conditions=development",
    "apps/worker/src/local.ts",
  ],
  ["exec", "vite", "--config", "apps/web/vite.config.ts"],
])
  children.push(spawn("pnpm", args, { stdio: "inherit", env: process.env }));
let exiting = false;
function stop(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const child of children) {
  child.on("error", (e) => {
    console.error(e);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!exiting) stop(code ?? 1);
  });
}

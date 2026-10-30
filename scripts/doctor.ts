import { execFileSync } from "node:child_process";
console.log(`Node ${process.version}`);
try {
  console.log(execFileSync("docker", ["compose", "ps"], { encoding: "utf8" }));
} catch {
  console.error("Start a Docker-compatible engine with Compose.");
  process.exitCode = 1;
}
for (const [name, url] of Object.entries({
  Dashboard: "http://localhost:5173",
  API: "http://localhost:3001/api/health",
  Mailpit: "http://localhost:8025/api/v1/info",
})) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    console.log(`${name}: ${r.status}`);
  } catch {
    console.log(`${name}: not running`);
  }
}

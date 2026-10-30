import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local", quiet: true });
import { createRuntime } from "@narada/runtime-aws";
import { runWorkers } from "./runner.js";
const runtime = createRuntime();
if (runtime.config.NARADA_MODE !== "local")
  throw new Error("Local workers require local mode");
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => controller.abort());
console.log("Narada workers ready");
try {
  await runWorkers(runtime, { signal: controller.signal });
} finally {
  runtime.store.client.destroy();
  runtime.queues.client.destroy();
}

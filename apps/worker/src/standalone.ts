import { createRuntime } from "@narada/runtime-aws";
import { runWorkers } from "./runner.js";
const runtime = createRuntime();
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => controller.abort());
try {
  await runWorkers(runtime, { signal: controller.signal });
} finally {
  runtime.store.client.destroy();
  runtime.queues.client.destroy();
}

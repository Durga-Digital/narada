import { createRuntime } from "@narada/runtime-aws";
import { startServer } from "./server.js";
const runtime = createRuntime();
const server = startServer(runtime, {
  port: Number(process.env.PORT ?? 3001),
  hostname: process.env.HOST ?? "127.0.0.1",
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    server.close(() => {
      runtime.store.client.destroy();
      runtime.queues.client.destroy();
    });
  });

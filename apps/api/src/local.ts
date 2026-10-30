import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local", quiet: true });
import { serve } from "@hono/node-server";
import { createRuntime } from "@narada/runtime-aws";
import { createApp } from "./app.js";
const runtime = createRuntime();
if (runtime.config.NARADA_MODE !== "local")
  throw new Error("Local server requires local mode");
serve(
  {
    fetch: createApp(runtime).fetch,
    port: Number(process.env.PORT ?? 3001),
    hostname: "127.0.0.1",
  },
  () => console.log("Narada API http://localhost:3001"),
);

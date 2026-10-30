import { initialize } from "./local.js";
await initialize();
console.log(
  "Local tables, queues, sender domain, and owner are ready. Existing data preserved.",
);

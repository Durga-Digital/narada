import { createInterface } from "node:readline/promises";
import { rm } from "node:fs/promises";
import { DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PurgeQueueCommand } from "@aws-sdk/client-sqs";
import { localEnv, initialize } from "./local.js";
import { createRuntime } from "@narada/runtime-aws";
import { awsOptions } from "@narada/core/config";
await localEnv();
const r = createRuntime();
const rl = createInterface({ input: process.stdin, output: process.stdout });
if (
  (await rl.question(
    "Stop pnpm dev first. Type RESET to delete Narada LOCAL data: ",
  )) !== "RESET"
) {
  rl.close();
  process.exit(0);
}
rl.close();
const db = new DynamoDBClient({
  ...awsOptions(r.config),
  endpoint: r.config.DYNAMODB_ENDPOINT,
});
for (const table of [r.config.APP_TABLE, r.config.AUTH_TABLE])
  try {
    await db.send(new DeleteTableCommand({ TableName: table }));
  } catch (e) {
    if (!(e instanceof Error && e.name === "ResourceNotFoundException"))
      throw e;
  }
for (const kind of ["work", "events"] as const)
  await r.queues.client.send(
    new PurgeQueueCommand({ QueueUrl: await r.queues.url(kind) }),
  );
await fetch("http://localhost:8025/api/v1/messages", { method: "DELETE" });
await rm(".local/owner.json", { force: true });
await initialize();
console.log("Local data reset.");

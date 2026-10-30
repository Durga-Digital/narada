import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { awsRuntime } from "@narada/runtime-aws/aws-runtime";
import { workHandler, eventHandler } from "./handlers.js";
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const runtime = await awsRuntime();
  const failed: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      await (process.env.WORKER_KIND === "events" ? eventHandler : workHandler)(
        runtime,
        record.body,
      );
    } catch (e) {
      console.error("Worker failed", {
        id: record.messageId,
        name: e instanceof Error ? e.name : "Error",
      });
      failed.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failed };
}
export async function dispatch() {
  await (await awsRuntime()).dispatcher.dispatch();
}

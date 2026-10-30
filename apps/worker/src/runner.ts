import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import type { Runtime } from "@narada/core/runtime";
import { workHandler, eventHandler } from "./handlers.js";
/** Await completion on shutdown; finish in-flight work before releasing clients. */
export async function runWorkers(
  runtime: Runtime,
  options: { signal: AbortSignal; pollIntervalMs?: number },
) {
  const { signal } = options;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function consume(kind: "work" | "events") {
    const url = await runtime.queues.url(kind);
    while (!signal.aborted) {
      try {
        const messages = await runtime.queues.client.send(
          new ReceiveMessageCommand({
            QueueUrl: url,
            WaitTimeSeconds: 2,
            MaxNumberOfMessages: 1,
            VisibilityTimeout: 30,
          }),
        );
        for (const m of messages.Messages ?? []) {
          await (kind === "work" ? workHandler : eventHandler)(
            runtime,
            m.Body!,
          );
          await runtime.queues.client.send(
            new DeleteMessageCommand({
              QueueUrl: url,
              ReceiptHandle: m.ReceiptHandle!,
            }),
          );
        }
      } catch (e) {
        console.error("Worker:", e instanceof Error ? e.message : e);
        await pause(options.pollIntervalMs ?? 1000);
      }
    }
  }
  async function dispatch() {
    while (!signal.aborted) {
      try {
        await runtime.dispatcher.dispatch();
      } catch (e) {
        console.error("Dispatcher:", e instanceof Error ? e.message : e);
      }
      await pause(options.pollIntervalMs ?? 1000);
    }
  }
  await Promise.all([consume("work"), consume("events"), dispatch()]);
}

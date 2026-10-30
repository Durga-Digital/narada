import { recoverWebhook } from "./webhooks.js";
import { randomUUID } from "node:crypto";
import { conditional, type Store } from "./store.js";
import type { Queues } from "./queue.js";
import type { Entity, Message } from "./model.js";
import type { Broadcast } from "./broadcast-model.js";
import { messageContentPaths } from "./message-retention.js";

/** Recovers durable work and publishes it to the existing queue. */
export class WorkDispatcher {
  constructor(
    readonly store: Store,
    readonly queues: Queues,
  ) {}
  async dispatch() {
    for (const item of await this.store.due<Broadcast>("broadcast-running")) {
      try {
        await this.store.patch(
          item.pk,
          { state: "broadcast", due: Date.now(), runToken: randomUUID() },
          { field: "state", value: "broadcast-running" },
        );
      } catch (e) {
        if (!conditional(e)) throw e;
      }
    }
    for (const item of await this.store.due<Entity>("webhook-running"))
      await recoverWebhook(this.store, String(item.id));
    for (const state of [
      "send",
      "webhook",
      "broadcast",
      "form",
      "publication",
      "publication-domain",
    ])
      for (const item of await this.store.due<Entity>(state)) {
        // Enqueue before deferring. A crash may enqueue twice; conditional worker claims make this safe.
        await this.queues.send("work", { kind: state, id: item.id });
        try {
          await this.store.patch(
            item.pk,
            { due: Date.now() + 30000 },
            { field: "state", value: state },
          );
        } catch (e) {
          if (!conditional(e)) throw e;
        }
      }
    for (const item of await this.store.due<Message>("submitting")) {
      try {
        await this.store.patch(
          item.pk,
          {
            status: "unknown",
            contentPurgedAt: new Date().toISOString(),
            state: "complete",
            error:
              "Worker stopped during submission. Inspect feedback before replay.",
          },
          { field: "status", value: "submitting" },
          messageContentPaths(item),
        );
      } catch (e) {
        if (!conditional(e)) throw e;
      }
    }
  }
}

import {
  SQSClient,
  GetQueueUrlCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { awsOptions, type Config } from "./config.js";

export class Queues {
  readonly client: SQSClient;
  constructor(readonly config: Config) {
    this.client = new SQSClient({
      ...awsOptions(config),
      endpoint: config.SQS_ENDPOINT,
    });
  }
  async url(kind: "work" | "events") {
    const configured =
      kind === "work"
        ? this.config.WORK_QUEUE_URL
        : this.config.EVENT_QUEUE_URL;
    if (configured) return configured;
    const r = await this.client.send(
      new GetQueueUrlCommand({ QueueName: `narada-${kind}` }),
    );
    return r.QueueUrl!;
  }
  async send(kind: "work" | "events", body: unknown, delaySeconds = 0) {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: await this.url(kind),
        MessageBody: JSON.stringify(body),
        DelaySeconds: delaySeconds,
      }),
    );
  }
}

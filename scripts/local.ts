import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { config as dotenv } from "dotenv";
import {
  CreateTableCommand,
  DynamoDBClient,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import {
  ensureSchema,
  assignSlots,
  deriveIndexMap,
} from "@datar-platform/better-auth-dynamodb";
import { getAuthTables } from "better-auth/db";
import { createAuth } from "@narada/core/auth";
import { oauthAuthOptions as authOptions } from "@narada/core/oauth-auth";
import { awsOptions } from "@narada/core/config";
import { createRuntime } from "@narada/runtime-aws";
import { verifyDomain } from "@narada/core/transport";
export const AUTH_LOOKUP_SLOTS = 6;
export async function localEnv() {
  await mkdir(".local", { recursive: true });
  try {
    await readFile(".env.local");
  } catch {
    await writeFile(
      ".env.local",
      `NARADA_MODE=local\nBETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}\n`,
      { mode: 0o600, flag: "wx" },
    );
  }
  dotenv({ path: ".env.local", quiet: true });
  if (process.env.NARADA_MODE !== "local")
    throw new Error("Local tooling refuses AWS mode");
}
export async function initialize(credentialsPath = ".local/owner.json") {
  await localEnv();
  const r = createRuntime();
  const db = new DynamoDBClient({
    ...awsOptions(r.config),
    endpoint: r.config.DYNAMODB_ENDPOINT,
  });
  let ready = false;
  for (let n = 0; n < 40; n++) {
    try {
      await db.send(
        new DescribeTableCommand({ TableName: r.config.APP_TABLE }),
      );
      ready = true;
      break;
    } catch (e) {
      if (e instanceof Error && e.name === "ResourceNotFoundException") {
        ready = true;
        break;
      }
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  if (!ready) throw new Error("DynamoDB unavailable; run pnpm dev:doctor");
  try {
    await db.send(
      new CreateTableCommand({
        TableName: r.config.APP_TABLE,
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
          { AttributeName: "scope", AttributeType: "S" },
          { AttributeName: "sort", AttributeType: "S" },
          { AttributeName: "state", AttributeType: "S" },
          { AttributeName: "due", AttributeType: "N" },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: "byScope",
            KeySchema: [
              { AttributeName: "scope", KeyType: "HASH" },
              { AttributeName: "sort", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
          {
            IndexName: "byState",
            KeySchema: [
              { AttributeName: "state", KeyType: "HASH" },
              { AttributeName: "due", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ],
      }),
    );
  } catch (e) {
    if (!(e instanceof Error && e.name === "ResourceInUseException")) throw e;
  }
  const slots = assignSlots(
    deriveIndexMap(getAuthTables(authOptions(r.config, r.store))),
  ).maxSlots;
  if (slots > AUTH_LOOKUP_SLOTS)
    throw new Error("Auth schema requires an infrastructure index upgrade");
  await ensureSchema({
    client: db,
    tableName: r.config.AUTH_TABLE,
    lookupSlots: AUTH_LOOKUP_SLOTS,
    ttlAttribute: "__ba_ttl",
  });
  try {
    await db.send(
      new UpdateTimeToLiveCommand({
        TableName: r.config.APP_TABLE,
        TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      }),
    );
  } catch (e) {
    if (!(e instanceof Error && e.name === "ValidationException")) throw e;
  }
  for (const kind of ["work", "events"] as const) {
    const dead = await r.queues.client.send(
      new CreateQueueCommand({ QueueName: `narada-${kind}-dead` }),
    );
    const attr = await r.queues.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: dead.QueueUrl,
        AttributeNames: ["QueueArn"],
      }),
    );
    await r.queues.client.send(
      new CreateQueueCommand({
        QueueName: `narada-${kind}`,
        Attributes: {
          VisibilityTimeout: "30",
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: attr.Attributes!.QueueArn,
            maxReceiveCount: 5,
          }),
        },
      }),
    );
  }
  await r.store.put(await verifyDomain(r.config, "narada.test"));
  const bootstrap = createAuth(r.config, r.store, true);
  const ctx = await bootstrap.$context;
  if (!(await ctx.internalAdapter.findUserByEmail(r.config.OWNER_EMAIL))) {
    const password = randomBytes(18).toString("base64url");
    await bootstrap.api.signUpEmail({
      body: { email: r.config.OWNER_EMAIL, password, name: "Narada Owner" },
    });
    await writeFile(
      credentialsPath,
      JSON.stringify({ email: r.config.OWNER_EMAIL, password }, null, 2),
      { mode: 0o600 },
    );
  }
  return r;
}

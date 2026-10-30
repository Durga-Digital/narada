import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterAll } from "vitest";
import { DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
// Vitest isolates each file. Never reuse developer tables or owner credentials.
const prefix = `narada-test-${randomUUID()}`;
process.env.NARADA_TEST_PREFIX = prefix;
afterAll(async () => {
  const client = new DynamoDBClient({
    region: "us-east-1",
    endpoint: "http://127.0.0.1:8000",
    credentials: { accessKeyId: "naradalocal", secretAccessKey: "naradalocal" },
  });
  try {
    for (const TableName of [`${prefix}-app`, `${prefix}-auth`]) {
      try {
        await client.send(new DeleteTableCommand({ TableName }));
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== "ResourceNotFoundException"
        )
          throw error;
      }
    }
  } finally {
    client.destroy();
    await rm(`.local/${prefix}-owner.json`, { force: true });
  }
});

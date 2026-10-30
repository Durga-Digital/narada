import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  buildTableDefinition,
  ensureSchema,
  deriveIndexMap,
  assignSlots,
} from "@datar-platform/better-auth-dynamodb";
import { getAuthTables } from "better-auth/db";
import { awsOptions, type Config } from "@narada/core/config";
import { Store } from "@narada/core/store";
import { createFeasibilityAuth, feasibilityAuthOptions } from "./auth.js";

export async function createFeasibilityRuntime(config: Config) {
  const store = new Store(config);
  // Validate the isolation boundary before creating or deleting any tables.
  const options = feasibilityAuthOptions(config, store);
  const db = new DynamoDBClient({
    ...awsOptions(config),
    endpoint: config.DYNAMODB_ENDPOINT,
  });
  const created: string[] = [];
  async function close() {
    try {
      for (const TableName of created)
        await db.send(new DeleteTableCommand({ TableName }));
    } finally {
      store.client.destroy();
      db.destroy();
    }
  }
  try {
    await db.send(
      new CreateTableCommand({
        TableName: config.APP_TABLE,
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
        ],
      }),
    );
    created.push(config.APP_TABLE);
    const lookupSlots = assignSlots(
      deriveIndexMap(getAuthTables(options)),
    ).maxSlots;
    await db.send(
      new CreateTableCommand(
        buildTableDefinition(config.AUTH_TABLE, lookupSlots),
      ),
    );
    created.push(config.AUTH_TABLE);
    await ensureSchema({
      client: db,
      tableName: config.AUTH_TABLE,
      lookupSlots,
      ttlAttribute: "__ba_ttl",
    });
    // OAuth initializes its resources in storage: construct it after provisioning.
    const auth = createFeasibilityAuth(config, store);
    await auth.$context;
    return { config, store, auth, lookupSlots, close };
  } catch (error) {
    await close();
    throw error;
  }
}
export type FeasibilityRuntime = Awaited<
  ReturnType<typeof createFeasibilityRuntime>
>;

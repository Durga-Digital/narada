import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { fromIni } from "@aws-sdk/credential-providers";
import {
  deploymentConfig,
  deploymentEnvironment,
} from "./deployment-config.js";
import { assertDeploymentAccount } from "../infrastructure/environments.js";
import { purgeCompletedMessageContent } from "@narada/core/message-retention";

const { values } = parseArgs({
  options: {
    stage: { type: "string" },
    profile: { type: "string" },
    region: { type: "string" },
    apply: { type: "boolean", default: false },
  },
  strict: true,
});
if (!values.stage)
  throw new Error("Specify --stage staging or --stage production");
const target = deploymentConfig(values, process.env);
const options = {
  region: target.region,
  credentials: fromIni({ profile: target.profile }),
};
const identity = await new STSClient(options).send(
  new GetCallerIdentityCommand({}),
);
assertDeploymentAccount(identity.Account, target.account);
// Resolve the current stack, not a user-supplied table or stale local outputs.
const table = execFileSync(
  "aws",
  [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    `Narada-${target.stage}`,
    "--profile",
    target.profile,
    "--region",
    target.region,
    "--query",
    "Stacks[0].Outputs[?OutputKey=='ApplicationTable'].OutputValue | [0]",
    "--output",
    "text",
  ],
  { encoding: "utf8", env: deploymentEnvironment(process.env, target) },
).trim();
if (!table || table === "None")
  throw new Error("ApplicationTable output missing");
console.log({
  stage: target.stage,
  account: target.account,
  region: target.region,
  table,
  apply: values.apply,
});
const client = DynamoDBDocumentClient.from(new DynamoDBClient(options));
// Narada currently uses a single project; this deliberately does not scan the whole table.
console.log(
  await purgeCompletedMessageContent(client, table, "default", values.apply),
);

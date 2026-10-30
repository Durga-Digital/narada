import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
} from "@aws-sdk/client-ssm";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { z } from "zod";
import { parseArgs } from "node:util";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { fromEnv, fromIni } from "@aws-sdk/credential-providers";
import {
  deploymentConfig,
  deploymentEnvironment,
} from "./deployment-config.js";
import { assertDeploymentAccount } from "../infrastructure/environments.js";
const { values: options } = parseArgs({
  options: {
    stage: { type: "string" },
    profile: { type: "string" },
    region: { type: "string" },
    plan: { type: "boolean", default: false },
    bootstrap: { type: "boolean", default: false },
    ci: { type: "boolean", default: false },
  },
  strict: true,
});
if (options.plan && options.bootstrap)
  throw new Error(
    "--plan never bootstraps. Run --bootstrap when applying the deployment.",
  );
const settings = deploymentConfig(options, process.env);
if (options.ci && (options.bootstrap || options.profile))
  throw new Error("CI cannot bootstrap AWS or use a local profile");
const environment = deploymentEnvironment(
  process.env,
  settings,
  options.ci ? "ci" : "profile",
);
const profileArgs = options.ci ? [] : ["--profile", settings.profile];
const clientOptions = {
  region: settings.region,
  credentials: options.ci ? fromEnv() : fromIni({ profile: settings.profile }),
};
// Check identity before any SSM, bootstrap, CloudFormation, or Lambda mutation.
const identity = await new STSClient(clientOptions).send(
  new GetCallerIdentityCommand({}),
);
assertDeploymentAccount(identity.Account, settings.account);
console.log(
  `Narada ${settings.stage}: account ${settings.account}, region ${settings.region}, profile ${settings.profile}`,
);
const run = (args: string[]) => {
  const result = spawnSync("pnpm", args, {
    stdio: "inherit",
    env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Command failed: pnpm ${args.join(" ")}`);
};
// Validate and build before making any cloud changes. This script itself is the deployment action.
run(["check"]);
run(["infra:check"]);
const stackName = `Narada-${settings.stage}`;
const assembly = environment.CDK_OUTDIR;
const cdk = ["exec", "cdk"];
// Template-only comparison does not create a change set or publish assets.
if (options.plan) {
  run([
    ...cdk,
    "diff",
    stackName,
    "--app",
    assembly,
    ...profileArgs,
    "--change-set",
    "false",
  ]);
  console.log(
    "Preview complete. No infrastructure, parameters, or owner accounts were changed.",
  );
  process.exit(0);
}
await mkdir(".local", { recursive: true });
const ssm = new SSMClient(clientOptions);
const name = `/narada/${settings.stage}/auth-secret`;
if (!options.ci) {
  try {
    await ssm.send(new GetParameterCommand({ Name: name }));
  } catch (e) {
    if (!(e instanceof Error && e.name === "ParameterNotFound")) throw e;
    await ssm.send(
      new PutParameterCommand({
        Name: name,
        Type: "SecureString",
        Value: randomBytes(48).toString("base64url"),
        Overwrite: false,
        Description: "Narada Better Auth secret; preserve across deployments",
      }),
    );
  }
}
if (options.bootstrap)
  run([
    "exec",
    "cdk",
    "bootstrap",
    `aws://${settings.account}/${settings.region}`,
    "--profile",
    settings.profile,
    "--app",
    assembly,
  ]);
const outputsFile = `.local/deploy-${settings.account}-${settings.region}-${settings.stage}.json`;
run([
  "exec",
  "cdk",
  "deploy",
  `Narada-${settings.stage}`,
  "--app",
  assembly,
  ...profileArgs,
  ...(options.ci ? ["--require-approval", "never", "--ci"] : []),
  "--outputs-file",
  outputsFile,
]);
const outputs = JSON.parse(await readFile(outputsFile, "utf8"))[
  `Narada-${settings.stage}`
] as { Url: string; BootstrapFunction: string; AuthTable: string };
// CloudFormation can finish while a new DynamoDB GSI is still backfilling.
// Do not report a ready release or run auth bootstrap/smoke tests until it is usable.
const dynamo = new DynamoDBClient(clientOptions);
try {
  const deadline = Date.now() + 20 * 60 * 1000;
  for (;;) {
    const { Table } = await dynamo.send(
      new DescribeTableCommand({ TableName: outputs.AuthTable }),
    );
    const required = [
      "byType",
      ...Array.from({ length: 6 }, (_, i) => `lookup${i + 1}`),
    ];
    if (
      Table?.TableStatus === "ACTIVE" &&
      required.every((name) =>
        Table.GlobalSecondaryIndexes?.some(
          (index) => index.IndexName === name && index.IndexStatus === "ACTIVE",
        ),
      )
    )
      break;
    if (Date.now() >= deadline)
      throw new Error(
        "Deployment applied, but auth indexes are not ready. Wait for all indexes to become ACTIVE before validating OAuth.",
      );
    console.log("Waiting for auth lookup indexes to become ACTIVE...");
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
} finally {
  dynamo.destroy();
}
if (options.ci) {
  console.log(
    `Narada deployed: ${outputs.Url}. Existing owner and auth secret preserved.`,
  );
  process.exit(0);
}
const credentialsPath = `.local/aws-owner-${settings.account}-${settings.region}-${settings.stage}.json`;
let generatedNow = false;
let credentials: { email: string; password: string };
try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
  if (credentials.email !== settings.ownerEmail)
    throw new Error(
      "Owner email differs from the saved deployment. Use the existing owner or a new stage.",
    );
} catch (e) {
  if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  credentials = {
    email: settings.ownerEmail,
    password: randomBytes(24).toString("base64url"),
  };
  generatedNow = true;
  await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
}
const result = await new LambdaClient(clientOptions).send(
  new InvokeCommand({
    FunctionName: outputs.BootstrapFunction,
    Payload: Buffer.from(JSON.stringify(credentials)),
  }),
);
if (result.FunctionError)
  throw new Error(
    "Owner bootstrap failed. Inspect the Bootstrap Lambda logs and rerun deployment; the generated password is preserved.",
  );
const bootstrap = z
  .object({ created: z.boolean() })
  .parse(JSON.parse(Buffer.from(result.Payload ?? []).toString("utf8")));
const ownerMessage =
  !bootstrap.created && generatedNow
    ? "An owner already exists. Use its existing password or the password-reset flow; the newly generated local password was not applied."
    : `Owner credentials: ${credentialsPath}`;
console.log(
  `\nNarada deployed: ${outputs.Url}\n${ownerMessage}\nNext: add a domain, publish its DNS records, and request SES production access in ${settings.region}.\n`,
);

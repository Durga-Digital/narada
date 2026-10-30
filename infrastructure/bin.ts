import {
  environmentSettings,
  deploymentStage,
  assertDeploymentAccount,
} from "./environments.js";
import { App } from "aws-cdk-lib";
import { NaradaStack } from "./stack.js";
import { customDomainConfig } from "./custom-domain.js";
const app = new App({ outdir: process.env.CDK_OUTDIR ?? "cdk.out" });
const stage = deploymentStage(process.env.NARADA_STAGE ?? "production");
const target = environmentSettings(stage, process.env, true);
if (process.env.CDK_DEFAULT_ACCOUNT)
  assertDeploymentAccount(process.env.CDK_DEFAULT_ACCOUNT, target.account);
new NaradaStack(app, `Narada-${stage}`, {
  stage,
  terminationProtection: stage === "production",
  tags: { Application: "Narada", Environment: stage },
  ownerEmail: process.env.OWNER_EMAIL ?? target.ownerEmail,
  authFrom: process.env.AUTH_FROM ?? target.authFrom,
  customDomain: customDomainConfig(process.env, target.account),
  env: {
    account: target.account,
    region: process.env.AWS_REGION ?? target.region,
  },
});
app.synth();

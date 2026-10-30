import { App } from "aws-cdk-lib";
import {
  deploymentStage,
  environmentSettings,
  assertDeploymentAccount,
} from "./environments.js";
import { GithubDeliveryStack } from "./github-stack.js";

const stage = deploymentStage(process.env.NARADA_STAGE);
const target = environmentSettings(stage, process.env);
if (process.env.CDK_DEFAULT_ACCOUNT)
  assertDeploymentAccount(process.env.CDK_DEFAULT_ACCOUNT, target.account);
const app = new App({ outdir: `cdk.out/github-${stage}` });
new GithubDeliveryStack(app, `NaradaDelivery-${stage}`, {
  stage,
  repository: {
    name: process.env.NARADA_GITHUB_REPOSITORY ?? "",
    subjectPrefix: process.env.NARADA_GITHUB_SUBJECT_PREFIX ?? "",
  },
  env: { account: target.account, region: target.region },
  terminationProtection: true,
  providerArn: process.env.GITHUB_OIDC_PROVIDER_ARN,
  tags: { Application: "Narada", Environment: stage },
});
app.synth();

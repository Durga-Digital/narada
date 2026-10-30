import { readFileSync, existsSync } from "node:fs";

export type Stage = "staging" | "production";
export interface EnvironmentSettings {
  account: string;
  profile: string;
  region: string;
  ownerEmail: string;
  authFrom: string;
}
/** Operator configuration stays outside Git. Ambient CDK accounts never select a target. */
export function environmentSettings(
  stage: Stage,
  env: NodeJS.ProcessEnv,
  synthesisOnly = false,
): EnvironmentSettings {
  let file = env.NARADA_DEPLOY_CONFIG ?? "narada.deploy.json";
  if (
    synthesisOnly &&
    !existsSync(file) &&
    !env.NARADA_ACCOUNT_ID &&
    !env.NARADA_DEPLOY_CONFIG
  )
    file = "narada.deploy.example.json";
  const local =
    env.GITHUB_ACTIONS === "true" && !env.NARADA_DEPLOY_CONFIG && !synthesisOnly
      ? undefined
      : existsSync(file)
        ? JSON.parse(readFileSync(file, "utf8"))[stage]
        : undefined;
  if (env.NARADA_DEPLOY_CONFIG && !existsSync(file))
    throw new Error("NARADA_DEPLOY_CONFIG does not exist");
  const config = {
    account: env.NARADA_ACCOUNT_ID ?? local?.account,
    profile: env.AWS_PROFILE ?? local?.profile ?? `narada-${stage}`,
    region: env.AWS_REGION ?? local?.region,
    ownerEmail: env.OWNER_EMAIL ?? local?.ownerEmail,
    authFrom: env.AUTH_FROM ?? local?.authFrom,
  };
  if (Object.values(config).some((v) => typeof v !== "string" || !v.trim()))
    throw new Error(
      "Configure narada.deploy.json or NARADA_ACCOUNT_ID, AWS_REGION, OWNER_EMAIL and AUTH_FROM before deployment",
    );
  return config as EnvironmentSettings;
}
export function deploymentStage(value: string | undefined): Stage {
  if (value === "prod") return "production";
  if (value === "staging" || value === "production") return value;
  throw new Error("Choose --stage staging or --stage production explicitly.");
}
export function assertDeploymentAccount(
  actual: string | undefined,
  expected: string,
) {
  if (actual !== expected)
    throw new Error(
      `Wrong AWS account: expected ${expected}, received ${actual ?? "unknown"}. No deployment changes were made.`,
    );
}

import { z } from "zod";
import {
  environmentSettings,
  deploymentStage,
} from "../infrastructure/environments.js";

const schema = z.object({
  account: z.string().regex(/^\d{12}$/),
  stage: z.enum(["staging", "production"]),
  region: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/),
  profile: z.string().trim().min(1),
  ownerEmail: z.email(),
  authFrom: z
    .string()
    .trim()
    .refine((value) => {
      const address = value.match(/^[^<>\r\n]+<([^<>\r\n]+)>$/)?.[1] ?? value;
      return !/[\r\n]/.test(value) && z.email().safeParse(address).success;
    }, "AUTH_FROM must be an email address or Name <email@example.com>"),
});
export function deploymentConfig(
  options: { stage?: string; profile?: string; region?: string },
  env: NodeJS.ProcessEnv,
) {
  const stage = deploymentStage(options.stage ?? env.NARADA_STAGE);
  const target = environmentSettings(stage, env);
  return schema.parse({
    ...target,
    stage,
    profile: options.profile ?? env.AWS_PROFILE ?? target.profile,
    region: options.region ?? env.AWS_REGION ?? target.region,
    ownerEmail: env.OWNER_EMAIL ?? target.ownerEmail,
    authFrom: env.AUTH_FROM ?? target.authFrom,
  });
}

/** CDK and SDK calls must both use the explicitly selected profile. */
export function deploymentEnvironment(
  env: NodeJS.ProcessEnv,
  config: ReturnType<typeof deploymentConfig>,
  mode: "profile" | "ci" = "profile",
): NodeJS.ProcessEnv & { CDK_OUTDIR: string } {
  if (mode === "ci" && env.GITHUB_ACTIONS !== "true")
    throw new Error("CI credentials are only supported inside GitHub Actions");
  const clean = { ...env };
  for (const key of [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_SECURITY_TOKEN",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
    "AWS_ROLE_SESSION_NAME",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "CDK_DEFAULT_ACCOUNT",
    "CDK_DEFAULT_REGION",
    "CDK_DEPLOY_ACCOUNT",
    "CDK_DEPLOY_REGION",
  ])
    if (
      mode !== "ci" ||
      ![
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
      ].includes(key)
    )
      delete clean[key];
  if (mode === "ci") {
    delete clean.AWS_PROFILE;
    delete clean.AWS_DEFAULT_PROFILE;
  }
  return {
    ...clean,
    ...(mode === "profile" ? { AWS_PROFILE: config.profile } : {}),
    AWS_REGION: config.region,
    AWS_DEFAULT_REGION: config.region,
    CDK_DEFAULT_ACCOUNT: config.account,
    CDK_DEFAULT_REGION: config.region,
    NARADA_STAGE: config.stage,
    NARADA_ACCOUNT_ID: config.account,
    OWNER_EMAIL: config.ownerEmail,
    AUTH_FROM: config.authFrom,
    CDK_OUTDIR: `cdk.out/${config.stage}`,
  };
}

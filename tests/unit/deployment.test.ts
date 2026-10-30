import { describe, expect, it } from "vitest";
import {
  environmentSettings,
  assertDeploymentAccount,
} from "../../infrastructure/environments.js";
import {
  deploymentConfig,
  deploymentEnvironment,
} from "../../scripts/deployment-config.js";

const fixture = { NARADA_DEPLOY_CONFIG: "narada.deploy.example.json" };
const environments = {
  staging: environmentSettings("staging", fixture),
  production: environmentSettings("production", fixture),
};
describe("deployment account boundaries", () => {
  it("requires a stage and pins each environment to its designated account", () => {
    expect(() => deploymentConfig({}, {})).toThrow("Choose --stage");
    const staging = deploymentConfig({ stage: "staging" }, fixture);
    const production = deploymentConfig({ stage: "prod" }, fixture);
    expect(staging.account).toBe("111111111111");
    expect(production.account).toBe("222222222222");
    expect(production.stage).toBe("production");
    expect(staging.region).toBe("us-east-1");
    expect(() =>
      assertDeploymentAccount(staging.account, production.account),
    ).toThrow("Wrong AWS account");
    expect(() =>
      assertDeploymentAccount("333333333333", staging.account),
    ).toThrow("Wrong AWS account");
    expect(() => assertDeploymentAccount(undefined, staging.account)).toThrow(
      "Wrong AWS account",
    );
    expect(() =>
      assertDeploymentAccount(staging.account, staging.account),
    ).not.toThrow();
  });
  it("does not let stale account environment variables replace the destination", () => {
    const config = deploymentConfig(
      { stage: "staging" },
      { ...fixture, CDK_DEFAULT_ACCOUNT: environments.production.account },
    );
    const env = deploymentEnvironment(
      {
        AWS_ACCESS_KEY_ID: "stale",
        AWS_SECRET_ACCESS_KEY: "stale",
        AWS_SESSION_TOKEN: "stale",
        AWS_ROLE_ARN: "other-role",
        CDK_DEFAULT_ACCOUNT: environments.production.account,
        PATH: "/bin",
      },
      config,
    );
    expect(env.CDK_DEFAULT_ACCOUNT).toBe(environments.staging.account);
    expect(env.AWS_PROFILE).toBe("narada-staging");
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBeUndefined();
    expect(env.AWS_ROLE_ARN).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(env.CDK_OUTDIR).toBe("cdk.out/staging");
  });
  it("validates operator overrides while keeping account pins", () => {
    const config = deploymentConfig(
      { stage: "production", profile: "custom-sso", region: "us-east-1" },
      {
        ...fixture,
        OWNER_EMAIL: "owner@example.com",
        AUTH_FROM: "Auth <auth@example.com>",
      },
    );
    expect(config.profile).toBe("custom-sso");
    expect(config.account).toBe(environments.production.account);
    expect(config.region).toBe("us-east-1");
    expect(() =>
      deploymentConfig(
        { stage: "production" },
        { ...fixture, AUTH_FROM: "bad\r\nBcc: victim@example.com" },
      ),
    ).toThrow();
    expect(() => deploymentConfig({ stage: "unknown" }, {})).toThrow();
  });
});

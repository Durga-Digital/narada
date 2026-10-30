import { expect, it } from "vitest";
import { App } from "aws-cdk-lib";
import { environmentSettings } from "../../infrastructure/environments.js";
import { deploymentConfig } from "../../scripts/deployment-config.js";
import { GithubDeliveryStack } from "../../infrastructure/github-stack.js";

it("fails closed for an unconfigured CI installation", () => {
  expect(() =>
    deploymentConfig({ stage: "staging" }, { GITHUB_ACTIONS: "true" }),
  ).toThrow("Configure narada.deploy.json");
});
it("accepts explicit CI settings without consulting local operator defaults", () => {
  const target = deploymentConfig(
    { stage: "production" },
    {
      GITHUB_ACTIONS: "true",
      NARADA_ACCOUNT_ID: "444444444444",
      AWS_REGION: "eu-west-1",
      OWNER_EMAIL: "owner@example.org",
      AUTH_FROM: "Auth <auth@example.org>",
      CDK_DEFAULT_ACCOUNT: "555555555555",
    },
  );
  expect(target.account).toBe("444444444444");
  expect(target.profile).toBe("narada-production");
  expect(target.region).toBe("eu-west-1");
});
it("does not silently replace a missing explicitly selected config", () => {
  expect(() =>
    environmentSettings(
      "staging",
      { NARADA_DEPLOY_CONFIG: "/nonexistent/narada-config.json" },
      true,
    ),
  ).toThrow("does not exist");
});
it.each([
  "repo:*/*",
  "repo:other/narada",
  "repo:example/narada:ref:refs/heads/main",
  "repo:example@1/narada@2:environment:*",
])("rejects broad or mismatched OIDC subjects: %s", (subjectPrefix) => {
  expect(
    () =>
      new GithubDeliveryStack(new App(), "Trust", {
        stage: "staging",
        env: { account: "111111111111", region: "us-east-1" },
        repository: { name: "example/narada", subjectPrefix },
      }),
  ).toThrow("exact repository OIDC subject");
});

import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, it, expect } from "vitest";
import { GithubDeliveryStack } from "../../infrastructure/github-stack.js";
import {
  deploymentConfig,
  deploymentEnvironment,
} from "../../scripts/deployment-config.js";

const githubRepository = {
  name: "example/narada",
  subjectPrefix: "repo:example@123/narada@456",
};
describe("GitHub deployment boundaries", () => {
  it.each(["staging", "production"] as const)(
    "allows only auth-table metadata reads for %s readiness",
    (stage) => {
      const stack = new GithubDeliveryStack(new App(), "ReadinessTest", {
        stage,
        repository: githubRepository,
        env: { account: "111111111111", region: "ap-southeast-2" },
      });
      const policies =
        Template.fromStack(stack).findResources("AWS::IAM::Policy");
      const statements = Object.values(policies).flatMap(
        (policy) => policy.Properties.PolicyDocument.Statement,
      );
      const database = statements.filter((statement) =>
        JSON.stringify(statement.Action).includes("dynamodb:"),
      );
      expect(database).toHaveLength(1);
      expect(database[0].Action).toBe("dynamodb:DescribeTable");
      expect(database[0].Effect).toBe("Allow");
      expect(database[0].Resource).toEqual({
        "Fn::Join": [
          "",
          [
            "arn:",
            { Ref: "AWS::Partition" },
            `:dynamodb:ap-southeast-2:111111111111:table/Narada-${stage}-Auth*`,
          ],
        ],
      });
    },
  );
  it("requires the exact repository, audience and deployment environment", () => {
    const stack = new GithubDeliveryStack(new App(), "DeliveryTest", {
      stage: "staging",
      repository: githubRepository,
      env: { account: "111111111111", region: "ap-southeast-2" },
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "narada-staging-github-deploy",
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRoleWithWebIdentity",
            Effect: "Allow",
            Principal: {
              Federated: {
                Ref: Object.keys(
                  template.findResources("AWS::IAM::OIDCProvider"),
                )[0],
              },
            },
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": `${githubRepository.subjectPrefix}:environment:staging`,
              },
            },
          },
        ],
      },
    });
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    expect(policies).not.toContain("AdministratorAccess");
    expect(policies).not.toContain("auth-secret");
    expect(policies).not.toContain("lambda:InvokeFunction");
  });
  it("uses short-lived CI credentials without inheriting local profiles", () => {
    const config = deploymentConfig(
      { stage: "staging" },
      { NARADA_DEPLOY_CONFIG: "narada.deploy.example.json" },
    );
    expect(() => deploymentEnvironment({}, config, "ci")).toThrow(
      "GitHub Actions",
    );
    const env = deploymentEnvironment(
      {
        GITHUB_ACTIONS: "true",
        AWS_PROFILE: "wrong",
        AWS_DEFAULT_PROFILE: "wrong",
        AWS_ACCESS_KEY_ID: "temporary",
        AWS_SECRET_ACCESS_KEY: "temporary",
        AWS_SESSION_TOKEN: "temporary",
      },
      config,
      "ci",
    );
    expect(env.AWS_PROFILE).toBeUndefined();
    expect(env.AWS_DEFAULT_PROFILE).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBe("temporary");
    expect(env.CDK_DEFAULT_ACCOUNT).toBe("111111111111");
  });
});

import { CfnOutput, Stack, type StackProps, aws_iam as iam } from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { Stage } from "./environments.js";

/** Operator-managed trust setup; application releases never bootstrap this stack. */
export class GithubDeliveryStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      stage: Stage;
      providerArn?: string;
      repository: { name: string; subjectPrefix: string };
    },
  ) {
    super(scope, id, props);
    const githubRepository = props.repository;
    const [owner, repo] = githubRepository.name.split("/");
    const validPart = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/;
    if (
      !owner ||
      !repo ||
      !validPart.test(owner) ||
      !validPart.test(repo) ||
      githubRepository.name.split("/").length !== 2
    )
      throw new Error("Set NARADA_GITHUB_REPOSITORY to owner/repository");
    const prefix = githubRepository.subjectPrefix;
    const plain = `repo:${owner}/${repo}`;
    const identified = new RegExp(
      `^repo:${owner.replaceAll(".", "\\.")}@[0-9]+/${repo.replaceAll(".", "\\.")}@[0-9]+$`,
    );
    if (prefix !== plain && !identified.test(prefix))
      throw new Error(
        "Set an exact repository OIDC subject prefix; wildcards and other repositories are forbidden",
      );
    const providerArn =
      props.providerArn ??
      new iam.CfnOIDCProvider(this, "Github", {
        url: "https://token.actions.githubusercontent.com",
        clientIdList: ["sts.amazonaws.com"],
      }).ref;
    const role = new iam.Role(this, "Deploy", {
      roleName: `narada-${props.stage}-github-deploy`,
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `${githubRepository.subjectPrefix}:environment:${props.stage}`,
        },
      }),
      description: `Narada ${props.stage} releases from ${githubRepository.name}`,
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          "deploy",
          "file-publishing",
          "image-publishing",
          "lookup",
        ].map(
          (name) =>
            `arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-${name}-role-${this.account}-${this.region}`,
        ),
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [
          `arn:${this.partition}:cloudformation:${this.region}:${this.account}:stack/Narada-${props.stage}/*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:${this.partition}:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/hnb659fds/version`,
        ],
      }),
    );
    // deploy.ts waits for auth lookup indexes after CloudFormation completes.
    // This reads table metadata only, never account/session records.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:DescribeTable"],
        resources: [
          `arn:${this.partition}:dynamodb:${this.region}:${this.account}:table/Narada-${props.stage}-Auth*`,
        ],
      }),
    );
    new CfnOutput(this, "DeployRoleArn", { value: role.roleArn });
  }
}

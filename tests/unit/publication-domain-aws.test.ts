import { STSClient } from "@aws-sdk/client-sts";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ACMClient } from "@aws-sdk/client-acm";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { AwsPublicationDomainProvider } from "@narada/core/publication-domain-aws";
import { loadConfig } from "@narada/core/config";
const config = () =>
  loadConfig({
    NARADA_MODE: "aws",
    BETTER_AUTH_SECRET: "a".repeat(32),
    PUBLICATION_DOMAIN_ENVIRONMENT: "test",
    PUBLICATION_DOMAIN_ACCOUNT: "123456789012",
    PUBLICATION_SITE_ORIGIN:
      "https://abcdef.execute-api.ap-southeast-2.amazonaws.com",
    PUBLICATION_SITE_FUNCTION_ARN:
      "arn:aws:cloudfront::123456789012:function/public-host",
  });
const binding = () => ({
  id: "12345678-1234-1234-1234-123456789012",
  hostname: "news.example.com",
  secret: "b".repeat(64),
  certificateIntentAt: new Date().toISOString(),
});
const tags = [
  { Key: "narada:resource", Value: "publication-domain" },
  { Key: "narada:environment", Value: "test" },
  { Key: "narada:connection", Value: binding().id },
];
const certificateArn = "arn:aws:acm:us-east-1:123456789012:certificate/abc";
beforeEach(() => {
  vi.spyOn(STSClient.prototype, "send").mockResolvedValue({
    Account: "123456789012",
  } as never);
});
afterEach(() => vi.restoreAllMocks());
it("reconciles a tagged certificate after the ACM token expires instead of requesting another", async () => {
  const calls: string[] = [];
  vi.spyOn(ACMClient.prototype, "send").mockImplementation(
    async (command: any): Promise<any> => {
      calls.push(command.constructor.name);
      if (command.constructor.name === "ListCertificatesCommand")
        return {
          CertificateSummaryList: [
            { DomainName: "news.example.com", CertificateArn: certificateArn },
          ],
        };
      if (command.constructor.name === "ListTagsForCertificateCommand")
        return { Tags: tags };
      if (command.constructor.name === "DescribeCertificateCommand")
        return {
          Certificate: {
            DomainName: "news.example.com",
            SubjectAlternativeNames: ["news.example.com"],
            Status: "ISSUED",
            NotAfter: new Date(Date.now() + 86400_000),
          },
        };
      throw new Error("Unexpected provider mutation");
    },
  );
  const value = await new AwsPublicationDomainProvider(config()).certificate({
    ...binding(),
    certificateIntentAt: "2020-01-01T00:00:00Z",
  });
  expect(value.status).toBe("issued");
  expect(value.arn).toBe(certificateArn);
  expect(calls).not.toContain("RequestCertificateCommand");
});
it("fails closed on an unresolved old certificate intent and on a foreign account", async () => {
  const send = vi
    .spyOn(ACMClient.prototype, "send")
    .mockResolvedValue({ CertificateSummaryList: [] } as never);
  const provider = new AwsPublicationDomainProvider(config());
  await expect(
    provider.certificate({
      ...binding(),
      certificateIntentAt: "2020-01-01T00:00:00Z",
    }),
  ).rejects.toMatchObject({ code: "reconcile" });
  send.mockClear();
  await expect(
    provider.certificate({
      ...binding(),
      certificateArn: certificateArn.replace("123456789012", "000000000000"),
    }),
  ).rejects.toMatchObject({ code: "reconcile" });
  expect(send).not.toHaveBeenCalled();
});
it("creates a dedicated uncached website with a fixed origin, exact certificate, trusted headers and HTTPS-only mutations", async () => {
  vi.spyOn(ACMClient.prototype, "send").mockResolvedValue({
    Tags: tags,
  } as never);
  let created: any;
  vi.spyOn(CloudFrontClient.prototype, "send").mockImplementation(
    async (command: any): Promise<any> => {
      switch (command.constructor.name) {
        case "ListDistributionsCommand":
          return { DistributionList: { Items: [], IsTruncated: false } };
        case "CreateDistributionWithTagsCommand":
          created = command.input.DistributionConfigWithTags;
          return { Distribution: { Id: "E123" } };
        case "GetDistributionCommand":
          return {
            Distribution: {
              Id: "E123",
              ARN: "arn:aws:cloudfront::123456789012:distribution/E123",
              DomainName: "d123.cloudfront.net",
              Status: "Deployed",
              DistributionConfig: created.DistributionConfig,
            },
          };
        case "ListTagsForResourceCommand":
          return { Tags: { Items: tags } };
        default:
          throw new Error("Unexpected provider action");
      }
    },
  );
  const result = await new AwsPublicationDomainProvider(config()).distribution({
    ...binding(),
    certificateArn,
  });
  expect(result.status).toBe("deployed");
  const c = created.DistributionConfig;
  expect(c.Aliases).toEqual({ Quantity: 1, Items: ["news.example.com"] });
  expect(c.ViewerCertificate).toMatchObject({
    ACMCertificateArn: certificateArn,
    MinimumProtocolVersion: "TLSv1.2_2021",
  });
  expect(c.Origins.Items[0].DomainName).toBe(
    "abcdef.execute-api.ap-southeast-2.amazonaws.com",
  );
  expect(c.Origins.Items[0].CustomHeaders.Items).toContainEqual({
    HeaderName: "x-narada-origin-secret",
    HeaderValue: binding().secret,
  });
  expect(c.DefaultCacheBehavior.AllowedMethods.Items).toEqual(["GET", "HEAD"]);
  expect(c.DefaultCacheBehavior.ViewerProtocolPolicy).toBe("redirect-to-https");
  for (const behavior of c.CacheBehaviors.Items) {
    expect(behavior.ViewerProtocolPolicy).toBe("https-only");
    expect(behavior.CachePolicyId).toBe("4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
  }
  expect(created.Tags.Items).toEqual(tags);
});
it("does not disable unrelated distributions, even when their IDs are stored incorrectly", async () => {
  const calls: string[] = [];
  vi.spyOn(CloudFrontClient.prototype, "send").mockImplementation(
    async (command: any): Promise<any> => {
      calls.push(command.constructor.name);
      if (command.constructor.name === "GetDistributionCommand")
        return {
          Distribution: {
            ARN: "arn:aws:cloudfront::123456789012:distribution/E123",
            DistributionConfig: { CallerReference: "dashboard" },
          },
        };
      if (command.constructor.name === "ListTagsForResourceCommand")
        return { Tags: { Items: [] } };
      throw new Error("Unexpected mutation");
    },
  );
  await expect(
    new AwsPublicationDomainProvider(config()).disable({
      ...binding(),
      distributionId: "E123",
    }),
  ).rejects.toMatchObject({ code: "reconcile" });
  expect(calls).not.toContain("UpdateDistributionCommand");
});

it("finishes cleanup after a distribution deletion response was lost", async () => {
  vi.spyOn(CloudFrontClient.prototype, "send").mockRejectedValue(
    Object.assign(new Error("gone"), { name: "NoSuchDistribution" }),
  );
  const result = await new AwsPublicationDomainProvider(config()).disable({
    ...binding(),
    distributionId: "E123",
    distributionHostname: "d123.cloudfront.net",
  });
  expect(result.status).toBe("deleted");
});

it("refuses provider calls when the AWS credentials belong to another account", async () => {
  vi.mocked(STSClient.prototype.send).mockResolvedValue({
    Account: "000000000000",
  } as never);
  const acm = vi.spyOn(ACMClient.prototype, "send");
  const cf = vi.spyOn(CloudFrontClient.prototype, "send");
  await expect(
    new AwsPublicationDomainProvider(config()).certificate(binding()),
  ).rejects.toMatchObject({ code: "reconcile" });
  expect(acm).not.toHaveBeenCalled();
  expect(cf).not.toHaveBeenCalled();
});

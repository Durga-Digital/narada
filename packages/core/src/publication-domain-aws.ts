import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  ACMClient,
  RequestCertificateCommand,
  DescribeCertificateCommand,
  ListCertificatesCommand,
  ListTagsForCertificateCommand,
  DeleteCertificateCommand,
} from "@aws-sdk/client-acm";
import {
  CloudFrontClient,
  CreateDistributionWithTagsCommand,
  GetDistributionCommand,
  GetDistributionConfigCommand,
  ListDistributionsCommand,
  ListTagsForResourceCommand,
  UpdateDistributionCommand,
  DeleteDistributionCommand,
  type DistributionConfig,
} from "@aws-sdk/client-cloudfront";
import type { Config } from "./config.js";
import { hash } from "./model.js";
import {
  DomainProviderError,
  type DomainProviderBinding,
  type PublicationDomainProvider,
  type CertificateObservation,
  type DistributionObservation,
} from "./publication-domain-provider.js";

export class AwsPublicationDomainProvider implements PublicationDomainProvider {
  readonly available: boolean;
  private acm = new ACMClient({
    region: "us-east-1",
    maxAttempts: 2,
    requestHandler: { requestTimeout: 6000, connectionTimeout: 2000 },
  });
  private cf = new CloudFrontClient({
    region: "us-east-1",
    maxAttempts: 2,
    requestHandler: { requestTimeout: 6000, connectionTimeout: 2000 },
  });
  constructor(private config: Config) {
    this.available =
      config.NARADA_MODE === "aws" &&
      !!config.PUBLICATION_SITE_ORIGIN &&
      !!config.PUBLICATION_SITE_FUNCTION_ARN &&
      !!config.PUBLICATION_DOMAIN_ACCOUNT;
  }
  private accountCheck?: Promise<void>;
  private async assertAccount() {
    if (!this.available) throw new DomainProviderError("reconcile");
    this.accountCheck ??= new STSClient({
      region: "us-east-1",
      maxAttempts: 2,
      requestHandler: { requestTimeout: 6000, connectionTimeout: 2000 },
    })
      .send(new GetCallerIdentityCommand({}))
      .then((identity) => {
        if (identity.Account !== this.config.PUBLICATION_DOMAIN_ACCOUNT)
          throw new DomainProviderError("reconcile");
      })
      .catch((error) => {
        this.accountCheck = undefined;
        throw error;
      });
    await this.accountCheck;
  }
  private tags(b: DomainProviderBinding) {
    return [
      { Key: "narada:resource", Value: "publication-domain" },
      {
        Key: "narada:environment",
        Value: this.config.PUBLICATION_DOMAIN_ENVIRONMENT,
      },
      { Key: "narada:connection", Value: b.id },
    ];
  }
  private owned(
    tags: { Key?: string; Value?: string }[],
    b: DomainProviderBinding,
  ) {
    return this.tags(b).every((t) =>
      tags.some((v) => v.Key === t.Key && v.Value === t.Value),
    );
  }
  private assertArn(arn: string, service: "acm" | "cloudfront") {
    const prefix = `arn:aws:${service}:${service === "acm" ? "us-east-1" : ""}:${this.config.PUBLICATION_DOMAIN_ACCOUNT}:`;
    if (!this.available || !arn.startsWith(prefix))
      throw new DomainProviderError("reconcile");
  }
  private async assertCertificate(arn: string, b: DomainProviderBinding) {
    await this.assertAccount();
    this.assertArn(arn, "acm");
    const tags = await this.acm.send(
      new ListTagsForCertificateCommand({ CertificateArn: arn }),
    );
    if (!this.owned(tags.Tags ?? [], b))
      throw new DomainProviderError("reconcile");
  }
  async certificate(b: DomainProviderBinding): Promise<CertificateObservation> {
    await this.assertAccount();
    let arn = b.certificateArn;
    if (!arn) {
      // Reconcile tagged requests even after ACM's one-hour idempotency window.
      let token: string | undefined;
      const matches: string[] = [];
      for (let page = 0; page < 10; page++) {
        const result = await this.acm.send(
          new ListCertificatesCommand({ NextToken: token, MaxItems: 1000 }),
        );
        for (const cert of result.CertificateSummaryList ?? [])
          if (cert.DomainName === b.hostname && cert.CertificateArn) {
            const tags = await this.acm.send(
              new ListTagsForCertificateCommand({
                CertificateArn: cert.CertificateArn,
              }),
            );
            if (this.owned(tags.Tags ?? [], b))
              matches.push(cert.CertificateArn);
          }
        token = result.NextToken;
        if (!token) break;
      }
      if (token || matches.length > 1)
        throw new DomainProviderError("reconcile");
      arn = matches[0];
      if (!arn) {
        if (
          !b.certificateIntentAt ||
          Date.now() - Date.parse(b.certificateIntentAt) > 55 * 60_000
        )
          throw new DomainProviderError("reconcile");
        const result = await this.acm.send(
          new RequestCertificateCommand({
            DomainName: b.hostname,
            ValidationMethod: "DNS",
            KeyAlgorithm: "RSA_2048",
            IdempotencyToken: hash(
              `${this.config.PUBLICATION_DOMAIN_ENVIRONMENT}:${b.id}`,
            ).slice(0, 32),
            Tags: this.tags(b),
          }),
        );
        arn = result.CertificateArn;
      }
    }
    if (!arn) throw new DomainProviderError("retry");
    await this.assertCertificate(arn, b);
    const cert = (
      await this.acm.send(
        new DescribeCertificateCommand({ CertificateArn: arn }),
      )
    ).Certificate;
    if (
      !cert ||
      cert.DomainName !== b.hostname ||
      cert.SubjectAlternativeNames?.some((n) => n !== b.hostname)
    )
      throw new DomainProviderError("reconcile");
    const record = cert.DomainValidationOptions?.find(
      (v) => v.DomainName === b.hostname,
    )?.ResourceRecord;
    return {
      arn,
      status:
        cert.Status === "ISSUED" &&
        cert.NotAfter &&
        cert.NotAfter.getTime() > Date.now()
          ? "issued"
          : cert.Status === "PENDING_VALIDATION"
            ? "pending"
            : "invalid",
      ...(cert.NotAfter ? { expiresAt: cert.NotAfter.toISOString() } : {}),
      ...(record?.Name && record.Value
        ? { validation: { name: record.Name, value: record.Value } }
        : {}),
    };
  }
  private caller(b: DomainProviderBinding) {
    return `narada:${this.config.PUBLICATION_DOMAIN_ENVIRONMENT}:${b.id}:v1`;
  }
  private async readDistribution(id: string, b: DomainProviderBinding) {
    await this.assertAccount();
    if (!/^[A-Z0-9]{1,32}$/.test(id))
      throw new DomainProviderError("reconcile");
    const result = await this.cf.send(new GetDistributionCommand({ Id: id }));
    const d = result.Distribution;
    if (!d?.ARN) throw new DomainProviderError("retry");
    this.assertArn(d.ARN, "cloudfront");
    const tags = await this.cf.send(
      new ListTagsForResourceCommand({ Resource: d.ARN }),
    );
    if (
      !this.owned(tags.Tags?.Items ?? [], b) ||
      d.DistributionConfig?.CallerReference !== this.caller(b) ||
      d.DistributionConfig.Aliases?.Quantity !== 1 ||
      d.DistributionConfig.Aliases.Items?.[0] !== b.hostname
    )
      throw new DomainProviderError("reconcile");
    return d;
  }
  private observation(
    d: Awaited<ReturnType<AwsPublicationDomainProvider["readDistribution"]>>,
  ): DistributionObservation {
    return {
      id: d.Id!,
      hostname: d.DomainName!,
      status:
        d.Status !== "Deployed"
          ? "deploying"
          : d.DistributionConfig?.Enabled
            ? "deployed"
            : "disabled",
    };
  }
  private configuration(b: DomainProviderBinding): DistributionConfig {
    const origin = new URL(this.config.PUBLICATION_SITE_ORIGIN!);
    if (
      origin.protocol !== "https:" ||
      !/^[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/.test(
        origin.hostname,
      ) ||
      origin.pathname !== "/"
    )
      throw new DomainProviderError("reconcile");
    const behavior = {
      TargetOriginId: "publication-site",
      Compress: true,
      CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", // AWS CachingDisabled
      OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac", // AWS AllViewerExceptHostHeader
      FunctionAssociations: {
        Quantity: 1,
        Items: [
          {
            EventType: "viewer-request" as const,
            FunctionARN: this.config.PUBLICATION_SITE_FUNCTION_ARN!,
          },
        ],
      },
    };
    return {
      CallerReference: this.caller(b),
      Comment: "Narada publication website v1",
      Enabled: true,
      Aliases: { Quantity: 1, Items: [b.hostname] },
      Origins: {
        Quantity: 1,
        Items: [
          {
            Id: "publication-site",
            DomainName: origin.hostname,
            CustomHeaders: {
              Quantity: 2,
              Items: [
                { HeaderName: "x-narada-binding", HeaderValue: b.id },
                { HeaderName: "x-narada-origin-secret", HeaderValue: b.secret },
              ],
            },
            CustomOriginConfig: {
              HTTPPort: 80,
              HTTPSPort: 443,
              OriginProtocolPolicy: "https-only",
              OriginSslProtocols: { Quantity: 1, Items: ["TLSv1.2"] },
              OriginReadTimeout: 30,
              OriginKeepaliveTimeout: 5,
            },
          },
        ],
      },
      DefaultCacheBehavior: {
        ...behavior,
        ViewerProtocolPolicy: "redirect-to-https",
        AllowedMethods: {
          Quantity: 2,
          Items: ["GET", "HEAD"],
          CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
        },
      },
      CacheBehaviors: {
        Quantity: 2,
        Items: ["/subscribe", "/confirm"].map((PathPattern) => ({
          ...behavior,
          PathPattern,
          ViewerProtocolPolicy: "https-only",
          AllowedMethods: {
            Quantity: 7,
            Items: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
            CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
          },
        })),
      },
      ViewerCertificate: {
        ACMCertificateArn: b.certificateArn,
        SSLSupportMethod: "sni-only",
        MinimumProtocolVersion: "TLSv1.2_2021",
      },
      HttpVersion: "http2and3",
      IsIPV6Enabled: true,
      PriceClass: "PriceClass_All",
      Restrictions: {
        GeoRestriction: { RestrictionType: "none", Quantity: 0 },
      },
      CustomErrorResponses: {
        Quantity: 11,
        Items: [400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504].map(
          (ErrorCode) => ({
            ErrorCode,
            ErrorCachingMinTTL: 0,
          }),
        ),
      },
    };
  }
  async distribution(
    b: DomainProviderBinding,
  ): Promise<DistributionObservation> {
    if (!this.available || !b.certificateArn)
      throw new DomainProviderError("reconcile");
    await this.assertAccount();
    let id = b.distributionId;
    if (!id) {
      let marker: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = (
          await this.cf.send(
            new ListDistributionsCommand({ Marker: marker, MaxItems: 100 }),
          )
        ).DistributionList;
        for (const d of result?.Items ?? [])
          if (d.Aliases?.Items?.includes(b.hostname)) {
            await this.readDistribution(d.Id!, b); // Fail closed on an alias owned by another connection.
            if (id) throw new DomainProviderError("reconcile");
            id = d.Id;
          }
        marker = result?.IsTruncated ? result.NextMarker : undefined;
        if (!marker) break;
      }
      if (marker) throw new DomainProviderError("reconcile");
      if (!id) {
        await this.assertCertificate(b.certificateArn, b);
        const result = await this.cf.send(
          new CreateDistributionWithTagsCommand({
            DistributionConfigWithTags: {
              DistributionConfig: this.configuration(b),
              Tags: { Items: this.tags(b) },
            },
          }),
        );
        id = result.Distribution?.Id;
      }
    }
    if (!id) throw new DomainProviderError("retry");
    return this.observation(await this.readDistribution(id, b));
  }
  async disable(b: DomainProviderBinding): Promise<DistributionObservation> {
    let d: Awaited<
      ReturnType<AwsPublicationDomainProvider["readDistribution"]>
    >;
    try {
      d = await this.readDistribution(b.distributionId!, b);
    } catch (error) {
      // Deletion may have succeeded before its response/checkpoint was lost.
      if (error instanceof Error && error.name === "NoSuchDistribution")
        return {
          id: b.distributionId!,
          hostname: b.distributionHostname!,
          status: "deleted",
        };
      throw error;
    }
    if (d.DistributionConfig?.Enabled) {
      const result = await this.cf.send(
        new GetDistributionConfigCommand({ Id: b.distributionId }),
      );
      if (result.DistributionConfig?.CallerReference !== this.caller(b))
        throw new DomainProviderError("reconcile");
      await this.cf.send(
        new UpdateDistributionCommand({
          Id: b.distributionId,
          IfMatch: result.ETag,
          DistributionConfig: { ...result.DistributionConfig!, Enabled: false },
        }),
      );
      return { ...this.observation(d), status: "deploying" as const };
    }
    return this.observation(d);
  }
  async deleteDistribution(b: DomainProviderBinding) {
    try {
      const d = await this.readDistribution(b.distributionId!, b);
      if (d.Status !== "Deployed" || d.DistributionConfig?.Enabled)
        throw new DomainProviderError("retry");
      const result = await this.cf.send(
        new GetDistributionConfigCommand({ Id: b.distributionId }),
      );
      if (
        result.DistributionConfig?.Enabled ||
        result.DistributionConfig?.CallerReference !== this.caller(b)
      )
        throw new DomainProviderError("reconcile");
      await this.cf.send(
        new DeleteDistributionCommand({
          Id: b.distributionId,
          IfMatch: result.ETag,
        }),
      );
    } catch (e) {
      if (!(e instanceof Error && e.name === "NoSuchDistribution")) throw e;
    }
  }
  async deleteCertificate(b: DomainProviderBinding) {
    if (!b.certificateArn) return;
    try {
      await this.assertCertificate(b.certificateArn, b);
      const cert = (
        await this.acm.send(
          new DescribeCertificateCommand({ CertificateArn: b.certificateArn }),
        )
      ).Certificate;
      if (cert?.InUseBy?.length) throw new DomainProviderError("retry");
      await this.acm.send(
        new DeleteCertificateCommand({ CertificateArn: b.certificateArn }),
      );
    } catch (e) {
      if (!(e instanceof Error && e.name === "ResourceNotFoundException"))
        throw e;
    }
  }
}

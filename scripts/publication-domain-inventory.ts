/** Read-only operator reconciliation. Never create, adopt, retag or delete resources. */
import {
  ACMClient,
  ListCertificatesCommand,
  ListTagsForCertificateCommand,
} from "@aws-sdk/client-acm";
import {
  CloudFrontClient,
  ListDistributionsCommand,
  ListTagsForResourceCommand,
} from "@aws-sdk/client-cloudfront";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { Store } from "@narada/core/store";
import { loadConfig } from "@narada/core/config";
import type { DomainConnection } from "@narada/core/publication-domains";
const account = process.env.PUBLICATION_DOMAIN_ACCOUNT,
  environment = process.env.PUBLICATION_DOMAIN_ENVIRONMENT;
if (
  !account ||
  !environment ||
  !process.env.APP_TABLE ||
  process.env.NARADA_MODE !== "aws"
)
  throw new Error(
    "Set NARADA_MODE=aws, APP_TABLE, PUBLICATION_DOMAIN_ACCOUNT, PUBLICATION_DOMAIN_ENVIRONMENT and AWS_REGION for the intended environment",
  );
const actual = await new STSClient({}).send(new GetCallerIdentityCommand({}));
if (actual.Account !== account)
  throw new Error("AWS account does not match the requested inventory account");
// This command only uses Store; it does not initialize authentication or sign links.
const store = new Store(
  loadConfig({
    ...process.env,
    BETTER_AUTH_SECRET: "inventory-only-not-used-for-authentication",
  }),
);
const managed = (tags: { Key?: string; Value?: string }[]) =>
  tags.some(
    (t) => t.Key === "narada:resource" && t.Value === "publication-domain",
  ) &&
  tags.some((t) => t.Key === "narada:environment" && t.Value === environment);
const results: {
  kind: string;
  resource: string;
  connectionId: string;
  state: string;
  reconcile: boolean;
}[] = [];
async function record(
  kind: string,
  resource: string,
  tags: { Key?: string; Value?: string }[],
) {
  if (!managed(tags)) return;
  const id =
    tags.find((t) => t.Key === "narada:connection")?.Value ?? "missing";
  const row = await store.get<DomainConnection>(`PUBLICATIONDOMAIN#${id}`);
  results.push({
    kind,
    resource,
    connectionId: id,
    state: row?.status ?? "missing",
    reconcile:
      !row ||
      row.status === "disconnected" ||
      (kind === "certificate"
        ? row.certificateArn !== resource
        : !resource.endsWith(`/${row.distributionId}`)),
  });
}
const acm = new ACMClient({ region: "us-east-1" }),
  cf = new CloudFrontClient({ region: "us-east-1" });
let next: string | undefined;
for (let page = 0; page < 10; page++) {
  const response = await acm.send(
    new ListCertificatesCommand({ NextToken: next, MaxItems: 100 }),
  );
  for (const certificate of response.CertificateSummaryList ?? []) {
    const arn = certificate.CertificateArn!;
    await record(
      "certificate",
      arn,
      (
        await acm.send(
          new ListTagsForCertificateCommand({ CertificateArn: arn }),
        )
      ).Tags ?? [],
    );
  }
  next = response.NextToken;
  if (!next) break;
}
if (next)
  throw new Error(
    "Certificate inventory exceeds 1000 resources; inspect AWS tags with an operator inventory tool",
  );
for (let page = 0; page < 10; page++) {
  const response = (
    await cf.send(new ListDistributionsCommand({ Marker: next, MaxItems: 100 }))
  ).DistributionList;
  for (const distribution of response?.Items ?? []) {
    const arn = distribution.ARN!;
    await record(
      "distribution",
      arn,
      (await cf.send(new ListTagsForResourceCommand({ Resource: arn }))).Tags
        ?.Items ?? [],
    );
  }
  next = response?.IsTruncated ? response.NextMarker : undefined;
  if (!next) break;
}
if (next)
  throw new Error(
    "Distribution inventory exceeds 1000 resources; inspect AWS tags with an operator inventory tool",
  );
console.log(
  JSON.stringify({ account, environment, resources: results }, null, 2),
);

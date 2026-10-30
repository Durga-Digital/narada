import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { customDomainConfig } from "../infrastructure/custom-domain.js";
import {
  environmentSettings,
  deploymentStage,
} from "../infrastructure/environments.js";
const stage = process.env.NARADA_STAGE ?? "production";
const template = JSON.parse(
  await readFile(
    `${process.env.CDK_OUTDIR ?? "cdk.out"}/Narada-${stage}.template.json`,
    "utf8",
  ),
) as {
  Resources: Record<
    string,
    {
      Type: string;
      Properties: Record<string, unknown>;
      DependsOn?: string | string[];
    }
  >;
};
const resources = Object.values(template.Resources);
const customDomain = customDomainConfig(
  process.env,
  environmentSettings(deploymentStage(stage), process.env, true).account,
);
const distributionConfig = resources.find(
  (r) => r.Type === "AWS::CloudFront::Distribution",
)!.Properties.DistributionConfig as {
  Aliases?: string[];
  ViewerCertificate?: { AcmCertificateArn?: string };
  PriceClass?: string;
  Origins?: { Id: unknown; DomainName: unknown }[];
  CacheBehaviors?: {
    PathPattern: string;
    AllowedMethods: string[];
    CachePolicyId: unknown;
    OriginRequestPolicyId: unknown;
    ViewerProtocolPolicy: string;
    TargetOriginId: unknown;
  }[];
};
assert.equal(
  distributionConfig.PriceClass,
  "PriceClass_All",
  "API traffic must be eligible for Australian edge locations",
);
const newsletterBehavior = distributionConfig.CacheBehaviors?.find(
  (b) => b.PathPattern === "/n/*",
);
const apiBehavior = distributionConfig.CacheBehaviors?.find(
  (b) => b.PathPattern === "/api/*",
);
for (const path of ["/.well-known/*", "/oauth/*"]) {
  const behavior = distributionConfig.CacheBehaviors?.find(
    (b) => b.PathPattern === path,
  );
  assert(behavior, `${path} must reach the OAuth server`);
  assert.deepEqual(behavior.CachePolicyId, apiBehavior?.CachePolicyId);
  assert.deepEqual(
    behavior.OriginRequestPolicyId,
    apiBehavior?.OriginRequestPolicyId,
  );
  assert.deepEqual(behavior.AllowedMethods, apiBehavior?.AllowedMethods);
  assert.equal(behavior.ViewerProtocolPolicy, "https-only");
  assert.deepEqual(
    distributionConfig.Origins?.find((o) => o.Id === behavior.TargetOriginId)
      ?.DomainName,
    distributionConfig.Origins?.find(
      (o) => o.Id === apiBehavior?.TargetOriginId,
    )?.DomainName,
  );
}
const [authTableId, authTable] = Object.entries(template.Resources).find(
  ([id, r]) => id.startsWith("Auth") && r.Type === "AWS::DynamoDB::Table",
)!;
assert.deepEqual(
  (authTable.Properties.GlobalSecondaryIndexes as { IndexName: string }[])
    .map((index) => index.IndexName)
    .sort(),
  ["byType", "lookup1", "lookup2", "lookup3", "lookup4", "lookup5", "lookup6"],
);
for (const [id, fn] of Object.entries(template.Resources).filter(
  ([id, r]) =>
    /^(Api|Bootstrap)/.test(id) && r.Type === "AWS::Lambda::Function",
))
  assert(
    fn.DependsOn?.includes(authTableId),
    `${id} must wait for the auth schema migration`,
  );
assert(
  newsletterBehavior,
  "Newsletter pages need their own server-rendered origin behavior",
);
assert(
  newsletterBehavior.AllowedMethods.includes("POST"),
  "Newsletter signup and confirmation need POST",
);
assert.deepEqual(
  newsletterBehavior.CachePolicyId,
  apiBehavior?.CachePolicyId,
  "Newsletter pages must stay uncached for corrections and withdrawals",
);
assert.deepEqual(
  distributionConfig.Origins?.find(
    (o) => o.Id === newsletterBehavior.TargetOriginId,
  )?.DomainName,
  distributionConfig.Origins?.find((o) => o.Id === apiBehavior?.TargetOriginId)
    ?.DomainName,
);
assert(
  resources.some(
    (r) =>
      r.Type === "AWS::Lambda::EventSourceMapping" &&
      JSON.stringify(r.Properties.FilterCriteria ?? {}).includes("publication"),
  ),
  "Publication operations need durable stream dispatch",
);
const accessLogSettings = resources.find(
  (r) =>
    r.Type === "AWS::ApiGatewayV2::Stage" && !!r.Properties.AccessLogSettings,
)!.Properties.AccessLogSettings as { Format: string; DestinationArn: unknown };
assert(accessLogSettings.DestinationArn);
const accessFields = JSON.parse(accessLogSettings.Format);
assert.equal(accessFields.requestId, "$context.requestId");
assert.equal(accessFields.responseLatencyMs, "$context.responseLatency");
assert(
  !/sourceIp|queryString|authorization|requestBody/i.test(
    accessLogSettings.Format,
  ),
);
const [apiFunctionId, apiFunction] = Object.entries(template.Resources).find(
  ([id, r]) => id.startsWith("Api") && r.Type === "AWS::Lambda::Function",
)!;
assert.equal(apiFunction.Properties.MemorySize, 1024);
assert.equal(apiFunction.Properties.Runtime, "nodejs24.x");
assert.equal(apiFunction.Properties.Handler, "index.handler");
assert(
  resources.some(
    (resource) =>
      resource.Type === "AWS::ApiGatewayV2::Integration" &&
      resource.Properties.IntegrationType === "AWS_PROXY" &&
      resource.Properties.PayloadFormatVersion === "2.0" &&
      JSON.stringify(resource.Properties.IntegrationUri) ===
        JSON.stringify({ "Fn::GetAtt": [apiFunctionId, "Arn"] }),
  ),
  "The existing HTTP API must invoke the API Lambda through its v2 proxy integration",
);
assert.deepEqual(
  distributionConfig.Aliases ?? [],
  customDomain ? [customDomain.domainName] : [],
);
assert.equal(
  distributionConfig.ViewerCertificate?.AcmCertificateArn,
  customDomain?.certificateArn,
);
const publicUrl = resources.find(
  (r) =>
    r.Type === "AWS::SSM::Parameter" &&
    r.Properties.Name === `/narada/${stage}/public-url`,
)!;
if (customDomain) assert.equal(publicUrl.Properties.Value, customDomain.origin);
assert(
  !resources.some((r) => r.Type === "AWS::Route53::RecordSet"),
  "External DNS must remain operator-managed",
);
const tables = resources.filter((r) => r.Type === "AWS::DynamoDB::Table");
assert.equal(tables.length, 2);
for (const table of tables) {
  assert.equal(table.Properties.BillingMode, "PAY_PER_REQUEST");
  assert.equal(table.Properties.DeletionProtectionEnabled, true);
  assert.deepEqual(table.Properties.PointInTimeRecoverySpecification, {
    PointInTimeRecoveryEnabled: true,
  });
}
assert.equal(
  resources.filter(
    (r) =>
      r.Type === "AWS::EC2::NatGateway" || r.Type === "AWS::RDS::DBInstance",
  ).length,
  0,
);
const queues = resources.filter((r) => r.Type === "AWS::SQS::Queue");
assert.equal(queues.length, 4);
assert.equal(queues.filter((r) => r.Properties.RedrivePolicy).length, 2);
const appFunctions = resources.filter(
  (r) =>
    r.Type === "AWS::Lambda::Function" &&
    (r.Properties.Environment as { Variables?: { NARADA_MODE?: string } })
      ?.Variables?.NARADA_MODE === "aws",
);
assert.equal(appFunctions.length, 6);
for (const fn of appFunctions) {
  const env = (
    fn.Properties.Environment as { Variables: Record<string, string> }
  ).Variables;
  assert(!env.BETTER_AUTH_SECRET);
  assert(env.AUTH_SECRET_PARAMETER);
  assert(env.PUBLIC_URL_PARAMETER);
  assert.equal(env.BETTER_AUTH_URL, customDomain?.origin);
  assert.equal(fn.Properties.Runtime, "nodejs24.x");
}
assert(
  resources.some(
    (r) => r.Type === "AWS::SES::ConfigurationSetEventDestination",
  ),
);
// Detect CloudFormation dependency cycles, including references inside Fn::Sub.
function references(value: unknown, result = new Set<string>()) {
  if (Array.isArray(value)) {
    value.forEach((v) => references(v, result));
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (key === "Ref" && typeof v === "string") result.add(v);
      else if (key === "Fn::GetAtt" && Array.isArray(v))
        result.add(String(v[0]));
      else if (key === "Fn::Sub" && typeof v === "string") {
        for (const match of v.matchAll(/\$\{([^.}]+)(?:\.[^}]+)?\}/g))
          result.add(match[1]!);
      }
      references(v, result);
    }
  }
  return result;
}
const done = new Set<string>();
function visit(id: string, path: string[]) {
  if (done.has(id) || !template.Resources[id]) return;
  assert(!path.includes(id), `Dependency cycle: ${[...path, id].join(" -> ")}`);
  const resource = template.Resources[id]!;
  const deps = references(resource.Properties);
  for (const d of typeof resource.DependsOn === "string"
    ? [resource.DependsOn]
    : (resource.DependsOn ?? []))
    deps.add(d);
  for (const d of deps) visit(d, [...path, id]);
  done.add(id);
}
Object.keys(template.Resources).forEach((id) => visit(id, []));
console.log(
  "Infrastructure checks passed: serverless resources, queues, retention, secret references, and dependency graph.",
);

const policyText = JSON.stringify(
  resources.filter((r) => r.Type === "AWS::IAM::Policy"),
);
assert(policyText.includes("ses:PutEmailIdentityMailFromAttributes"));
assert(policyText.includes("ses:PutEmailIdentityDkimAttributes"));
assert(!policyText.includes("route53:ChangeResourceRecordSets"));

// Public form links must load the SPA without rewriting API or asset requests.
const formRouting = resources.find(
  (r) =>
    r.Type === "AWS::CloudFront::Function" &&
    String(r.Properties.FunctionCode).includes("/index.html"),
);
assert(formRouting);
const rewrite = new Function(
  `${formRouting.Properties.FunctionCode}; return handler;`,
)() as (event: { request: { uri: string } }) => { uri: string };
for (const uri of ["/forms/123", "/forms/confirm", "/forms/123/"])
  assert.equal(rewrite({ request: { uri } }).uri, "/index.html");
for (const uri of [
  "/api/forms/123",
  "/assets/app.js",
  "/",
  "/forms/123/responses",
])
  assert.equal(rewrite({ request: { uri } }).uri, uri);

// Media must never be public S3 objects or part of the pruned frontend deployment.
const mediaResource = Object.entries(template.Resources).find(
  ([id, r]) => id.startsWith("Media") && r.Type === "AWS::S3::Bucket",
);
assert(mediaResource, "An environment must own its media bucket");
const [mediaId, mediaBucket] = mediaResource;
assert.deepEqual(mediaBucket.Properties.PublicAccessBlockConfiguration, {
  BlockPublicAcls: true,
  BlockPublicPolicy: true,
  IgnorePublicAcls: true,
  RestrictPublicBuckets: true,
});
assert(
  mediaBucket.Properties.BucketEncryption,
  "Media must be encrypted at rest",
);
assert.equal(
  (mediaBucket as unknown as { DeletionPolicy: string }).DeletionPolicy,
  "Retain",
);
const mediaBehavior = distributionConfig.CacheBehaviors?.find(
  (b) => b.PathPattern === "/media/*",
);
assert(mediaBehavior, "CloudFront must serve immutable media separately");
assert.deepEqual(mediaBehavior.AllowedMethods, ["GET", "HEAD"]);
assert.notDeepEqual(mediaBehavior.CachePolicyId, apiBehavior?.CachePolicyId);
const mediaOrigin = distributionConfig.Origins?.find(
  (o) => o.Id === mediaBehavior.TargetOriginId,
);
assert(JSON.stringify(mediaOrigin?.DomainName).includes(mediaId));
assert(
  (mediaOrigin as unknown as { OriginAccessControlId: unknown })
    .OriginAccessControlId,
  "Media origin must use OAC",
);
const mediaApiFunction = Object.entries(template.Resources).find(
  ([id, r]) => id.startsWith("Api") && r.Type === "AWS::Lambda::Function",
)![1];
assert(
  JSON.stringify(mediaApiFunction.Properties.Environment).includes(
    `"MEDIA_BUCKET":{"Ref":"${mediaId}"}`,
  ),
);
for (const resource of resources.filter(
  (r) => r.Type === "Custom::CDKBucketDeployment",
))
  assert(
    !JSON.stringify(resource.Properties.DestinationBucketName).includes(
      mediaId,
    ),
    "Frontend deployments must never prune media",
  );
console.log("Media infrastructure invariants passed");

// Publication domains use a separate reader Lambda/gateway and runtime-managed hosting.
const publicSiteFunction = Object.entries(template.Resources).find(
  ([id, r]) =>
    id.startsWith("PublicationSite") && r.Type === "AWS::Lambda::Function",
);
assert(publicSiteFunction, "Dedicated public reader Lambda is required");
assert.equal(
  resources.filter((r) => r.Type === "AWS::CloudFront::Distribution").length,
  1,
  "CDK must not adopt runtime publication distributions",
);
assert.equal(
  resources.filter((r) => r.Type === "AWS::ApiGatewayV2::Api").length,
  2,
);
const hostFunction = resources.find(
  (r) =>
    r.Type === "AWS::CloudFront::Function" &&
    String(r.Properties.FunctionCode).includes("x-narada-public-host"),
);
assert(hostFunction);
assert(
  String(hostFunction.Properties.FunctionCode).includes(
    "request.headers.host.value",
  ),
);
const domainPolicyText = JSON.stringify(
  resources.filter((r) => r.Type === "AWS::IAM::Policy"),
);
assert(
  !/route53:ChangeResourceRecordSets/i.test(domainPolicyText),
  "Publication setup must not mutate DNS",
);
assert(domainPolicyText.includes("aws:ResourceTag/narada:environment"));
assert(domainPolicyText.includes("aws:RequestTag/narada:resource"));
assert(domainPolicyText.includes("acm:RequestCertificate"));
assert(domainPolicyText.includes("cloudfront:CreateDistribution"));
assert(
  JSON.stringify(
    resources.filter((r) => r.Type === "AWS::Lambda::EventSourceMapping"),
  ).includes("publication-domain"),
);

const forwardHost = new Function(
  `${hostFunction.Properties.FunctionCode}; return handler;`,
)() as (event: { request: { headers: Record<string, { value: string }> } }) => {
  headers: Record<string, { value: string }>;
};
const forwarded = forwardHost({
  request: {
    headers: {
      host: { value: "NEWS.Example.com" },
      "x-narada-public-host": { value: "forged.example.com" },
      authorization: { value: "secret" },
      cookie: { value: "owner-session" },
    },
  },
});
assert.equal(
  forwarded.headers["x-narada-public-host"]?.value,
  "news.example.com",
);
assert(!forwarded.headers.authorization && !forwarded.headers.cookie);
const publicRole = (
  publicSiteFunction[1].Properties.Role as { "Fn::GetAtt": string[] }
)["Fn::GetAtt"][0];
for (const policy of resources.filter(
  (r) =>
    r.Type === "AWS::IAM::Policy" &&
    JSON.stringify(r.Properties.Roles).includes(String(publicRole)),
)) {
  const document = JSON.stringify(policy.Properties.PolicyDocument);
  assert(
    !document.includes(authTableId),
    "Public reader must not access authentication storage",
  );
  assert(
    !/ses:|cloudfront:|acm:|s3:Put/.test(document),
    "Public reader must not provision, send directly or upload media",
  );
}

assert(domainPolicyText.includes("acm:AddTagsToCertificate"));
assert(
  !domainPolicyText.includes("cloudfront:CreateDistributionWithTags"),
  "CloudFront uses CreateDistribution IAM action for the tagged API",
);
const statements = resources
  .filter((r) => r.Type === "AWS::IAM::Policy")
  .flatMap(
    (r) =>
      (
        r.Properties.PolicyDocument as {
          Statement: {
            Action: string | string[];
            Resource: unknown;
            Effect: string;
            Condition?: unknown;
          }[];
        }
      ).Statement,
  );
for (const action of [
  "acm:RequestCertificate",
  "cloudfront:CreateDistribution",
]) {
  const statement = statements.find(
    (s) =>
      s.Effect === "Allow" &&
      (Array.isArray(s.Action) ? s.Action : [s.Action]).includes(action),
  );
  assert(statement);
  assert.equal(
    statement.Resource,
    "*",
    `${action} does not support resource ARN scoping`,
  );
  assert(
    JSON.stringify(statement.Condition).includes(
      "aws:RequestTag/narada:environment",
    ),
  );
}
assert(
  statements.some(
    (s) =>
      s.Effect === "Deny" &&
      JSON.stringify(s.Action).includes("cloudfront:UpdateDistribution"),
  ),
  "Dashboard distribution mutations must be explicitly denied",
);

assert(
  resources.some(
    (r) =>
      r.Type === "AWS::Logs::MetricFilter" &&
      JSON.stringify(r.Properties.FilterPattern).includes(
        "publication_domain_certificate_expiring",
      ),
  ),
  "Certificate renewal and unhealthy transitions need an operator alarm",
);

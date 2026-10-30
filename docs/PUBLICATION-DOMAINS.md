# Custom publication subdomains

Implementation status: local source and tests only. No AWS deployment, DNS changes, certificate issuance or SDK publication has been performed for this iteration. Real DNS/ACM/CloudFront verification remains a staging release gate.

## Local verification — 24 October 2026

The feature snapshot passed `pnpm contracts:generate`, `pnpm contracts:verify` (including SDK package checks and 458 contract tests), `pnpm check` (698 unit tests, TypeScript and production builds), and `pnpm infra:check`. All 242 integration tests passed across the full run and fixture-isolated reruns, including 36 OAuth MCP tests and 13 publication-domain tests. Four existing suites initially lacked credentials for reused test tables; their reruns used fresh prefixes, with the privacy suite also isolated from preceding login rate limits. Three browser flows passed: newsletter signup/publishing/unsubscribe, branding, and domain setup/activation/disconnect on desktop and mobile. Domain provisioning uses fake DNS/AWS adapters locally.

Final backend verification used an isolated source snapshot because unrelated sender-domain/search work was actively changing shared contracts in the main checkout. Those edits were preserved; the combined checkout still needs its contract/application gates rerun after that work stabilizes. No new API, SDK or MCP exclusions were introduced. Automatic DNS writes and the other deferred v1 features remain outside scope.

Each publication can connect one unused subdomain, such as `news.example.com`. Its default `/n/:slug` address stays available. The custom host serves only public reader pages: home, archive, articles, signup and confirmation. Dashboard login, REST, OAuth/MCP, email confirmation links, unsubscribe/preferences and immutable media remain on the installation origin.

## Connect an address

Open **Newsletters → publication → Domain**. Choose a suggestion from a saved verified sending identity or enter another owned subdomain. SES sending verification does not prove website control. Apex domains, wildcard names, IPs and existing Narada/mail hostnames are rejected.

1. Connect the hostname. This reserves it and returns a fresh `_narada.<hostname>` TXT value. Configuration revision zero means this publication has never configured a domain.
2. Add the TXT at your DNS provider. Use the full record name when managing a delegated zone; the displayed short name assumes the registrable root zone. Click **Check DNS and HTTPS** after publishing records. Checks are limited to one requested pass per 30 seconds.
3. After ownership is verified, add the certificate validation CNAME. Certificates are requested in `us-east-1` for the exact hostname. Check CAA restrictions if issuance fails.
4. Once hosting is prepared, point the website CNAME to the displayed CloudFront hostname. Use DNS-only mode. Do not overwrite existing A, AAAA, CNAME or MX records for a working service; use an unused hostname.
5. Wait for the DNS and HTTPS probe to pass, then select **Activate custom address**. The worker rechecks readiness before activation. Setting up a domain does not activate a publication, publish an issue or send email.

Keep ownership TXT and certificate validation CNAME records while connected. The UI, API and MCP return record names, values, observed status, next actions and certificate expiry. DNS timeouts are unknown observations, not proof that a record is absent.

## API, SDK and MCP

The five canonical operations are `publications.domain.get`, `.configure`, `.check`, `.activate` and `.disconnect`. REST uses `/api/v1/publications/:id/domain` with GET and PUT, plus POST `/check`, `/activate`, `/disconnect`. GET is side-effect-free; writes return HTTP 202 with the accepted snapshot. `X-Operation-Id` and `Operation-Location` identify the existing Activity/recovery record. Successful request acceptance is distinct from its asynchronous `publication-domain` work state.

Reads require `narada:publications:read`. All four writes require **`narada:publications:domains:write`**, which explicitly permits certificate/hosting allocation and address changes. Existing publication/branding scopes and legacy full keys do not inherit it. Publication and sender restrictions, current grants and replay authorization still apply. Sender restrictions constrain the publication's email sender, not the website hostname's parent domain. Fresh DNS proof controls website authorization.

```ts
const accepted = await narada.publications.domain.configure(
  publicationId,
  {
    hostname: "news.example.com",
    revision: 0,
  },
  { idempotencyKey: "connect-news-example-com" },
);

const setup = await narada.publications.domain.get(publicationId);
// Publish setup.domain.records at your DNS provider. Narada does not edit DNS.
await narada.publications.domain.check(
  publicationId,
  {
    revision: setup.domain!.revision,
  },
  { idempotencyKey: "check-news-1" },
);

const ready = await narada.publications.domain.get(publicationId);
if (ready.domain?.state === "ready") {
  await narada.publications.domain.activate(
    publicationId,
    {
      revision: ready.domain.revision,
    },
    { idempotencyKey: "activate-news-1" },
  );
}
```

Use the same mutation key after an uncertain response. Reload state before a new action; the domain configuration revision is independent of publication and worker observation revisions. Reconnection preserves the increasing configuration revision and issues a fresh binding ID and challenge. A connection cannot be replaced until disconnect cleanup finishes.

MCP exposes `publications_domain_get`, `_configure`, `_check`, `_activate` and `_disconnect` according to current consent. Mutations require stable `idempotencyKey` values. Disconnect is destructive, with default-address fallback. Scoped machine clients may suggest sending domains using the existing paginated `domains.list` operation if granted `narada:domains:read`; otherwise they can enter an exact hostname directly. No new transport exclusions apply to domain management.

## Health and disconnect

Normal provisioning polls once per minute; active connections check hourly. Repeated errors back off to one hour and stop after eight failures, leaving resources reserved for an explicit check/operator recovery. A successful certificate/DNS/HTTPS observation is trusted for at most 24 hours. Unknown DNS does not immediately replace the last healthy result. Three or more negative ownership observations spanning at least five minutes suspend the mapping; invalid/expired certificates suspend it immediately. Routing or HTTPS probe failures degrade the connection and restore default preferred links. Successful checks can restore an explicitly active connection. Expiry within 30 days produces a renewal warning, logged at most daily per connection. CloudWatch alarms cover unhealthy transitions and these renewal warnings.

Disconnect removes the public/preferred mapping in the accepting transaction. The worker disables the distribution, waits for deployment and retains it while any website CNAME/A/AAAA record remains or DNS is unknown. Remove the website record and allow DNS propagation before checking again. The stricter empty-address rule also protects against aliases and extra proxies; if replacing a hostname with another service, finish Narada cleanup first. It then deletes the dedicated distribution and unused certificate, releases capacity/reservation and retains the audit record. Narada never deletes DNS records. The old default site and sent email links keep working.

## Operator deployment and recovery

CDK adds a separate `PublicationSite` Lambda/API Gateway, a viewer-request host-forwarding function, worker IAM and stream/recovery wiring. Runtime creates one tagged standard CloudFront distribution and one ACM certificate per connection. Ordinary CDK deployment does not adopt or delete these resources. The dashboard distribution and its certificate remain separate.

The API and worker receive `PUBLICATION_SITE_ORIGIN` and `PUBLICATION_SITE_FUNCTION_ARN`; the environment supplies `PUBLICATION_DOMAIN_ENVIRONMENT` and `PUBLICATION_DOMAIN_ACCOUNT`. Local mode does not provision AWS resources; tests explicitly inject fake DNS/provider adapters. `PUBLICATION_DOMAIN_LIMIT` defaults to five concurrent connections and five creations per rolling hour (operator override 1–100). Disabled connections retain capacity until cleanup. These resources incur AWS charges; review current [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/) and [ACM pricing](https://aws.amazon.com/certificate-manager/pricing/) and account quotas before enabling production.

The worker persists intent before provider creation. CloudFront uses a stable caller reference. ACM uses a stable token only within 55 minutes of saved intent; after that it reconciles connection-tagged resources and refuses blind recreation if none can be found. Tag keys are `narada:resource=publication-domain`, `narada:environment` and `narada:connection`. Read-only operator inventory is available via `scripts/publication-domain-inventory.ts`; it lists managed resources and flags IDs without matching connection records. It never deletes or adopts resources. Investigate unresolved intent rather than manually creating replacements. Request-level Activity and structured `publication_domain_transition` logs expose state changes without secrets or token URLs.

IAM creation requires managed environment/resource request tags. Mutation/describe access is restricted to managed tagged resources and the deployment account; ACM is fixed to `us-east-1`. Creation and list operations require wildcard resources; create is constrained by environment/resource request tags, with ACM restricted to DNS validation and RSA-2048 in us-east-1. The tagged CloudFront API authorizes the CreateDistribution and TagResource IAM actions; ACM requests also require AddTagsToCertificate. See the [CloudFront authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html) and [ACM authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_acm.html). The dashboard distribution and configured dashboard certificate have explicit mutation/tagging denies. Tag reads permit account-local reconciliation; the adapter checks tags, account, exact hostname and caller reference before modifying anything. No Route 53 permissions are added. The reader Lambda has application-table access needed by existing subscription flows, but no auth-table, SES, CloudFront/ACM or media-write grant.

Origin secrets are per connection, retained until its resources are cleaned up, and excluded from API/MCP DTOs and logs. To rotate a potentially exposed secret in v1, disconnect, finish cleanup and reconnect to create a new generation. The gateway validates the binding, secret and viewer hostname; unknown/default CloudFront hosts and raw gateway requests fail closed. It mounts no authenticated application routes. Article-relative URLs are resolved against their historical default URL at render time; stored issues and email snapshots are unchanged.

Before a release, deploy to an explicitly selected staging hostname and verify real DNS ownership, ACM issuance/renewal diagnostics, CloudFront origin protection, HTTPS GET and insecure-POST behavior, signup/confirmation, fallback and safe cleanup. Local fake-provider tests do not establish AWS IAM, DNS propagation or certificate interoperability. Production deployment and SDK publication require separate requests.

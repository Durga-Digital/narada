# Narada

Transactional email, newsletters and forms with an AWS SES delivery backend and a fully local development environment. Built as a TypeScript/pnpm monorepo with React, shadcn/ui, Hono, Better Auth, DynamoDB, and AWS CDK.

Each installation has one owner and one workspace. Narada does not provide full Resend API parity. Transactional email and audience broadcasts are supported. Inbound email, attachments, team invitations, automations, and billing are outside this version.

**Start here:** [Documentation index](docs/README.md) · [Contributor guide](CONTRIBUTING.md) · [AWS operator guide](docs/SELF-HOSTING.md) · [Open-source readiness](docs/OPEN-SOURCE-READINESS.md). The application and SDK are licensed under [Apache 2.0](LICENSE); see [licensing and third-party notices](docs/LICENSING.md). Deployment settings belong in ignored local configuration or GitHub environment variables.

Run locally without an AWS account, or deploy an independent installation using the AWS operator guide. Deployment code targets AWS; local development services are not a general VPS production backend. Source implementation, deployment and npm publication are separate release states.

**Release reminder:** [How to deploy production manually](#deploy-production-manually). Pushes to `main` deploy staging only.

**Before sending through AWS:** Follow [SES onboarding](docs/SES-ONBOARDING.md) to verify sending domains, authorize staging test recipients, and request production access. Deploying the production environment does not remove SES sandbox restrictions.

## Run locally

Install Node.js 24, pnpm 11.9.0, and a Docker-compatible engine with Compose. Start Docker, then:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The command starts DynamoDB Local, ElasticMQ, and Mailpit; creates tables and queues; generates `.env.local` and an owner account; then starts the API, worker, and Vite with hot reload. The terminal prints the local login credentials, also saved in `.local/owner.json`. Local tooling uses dummy AWS credentials and refuses external AWS/SMTP endpoints.

| Service       | Address                          |
| ------------- | -------------------------------- |
| Dashboard     | http://localhost:5173            |
| Mailpit inbox | http://localhost:8025            |
| Queue console | http://localhost:9325            |
| API health    | http://localhost:3001/api/health |

Sign in, send an email from `hello@narada.test`, and open Mailpit. Message details let you inject delivery, bounce, or complaint events through the local event queue. Add `http://localhost:3001/api/dev/webhook-receiver` as a webhook endpoint to test signed delivery locally.

Docker contains the dependencies; application processes run on the host for fast hot reload and debugging. No AWS account is needed locally. DynamoDB and Mailpit persist in named volumes; ElasticMQ is ephemeral, and the durable database outbox re-enqueues pending sends after a restart.

Useful commands:

```sh
pnpm dev:doctor           # Diagnose ports and containers
pnpm dev --no-containers # Run against containers already started
pnpm dev:seed             # Idempotent initialization; preserves existing data
pnpm dev:down             # Stop dependency containers; preserve volumes
pnpm dev:reset            # After stopping dev; requires typing RESET
```

If Docker image downloads stall in `docker-credential-desktop`, unlock the macOS login keychain or restart Docker Desktop. Do not delete your Docker credentials. Ports 3001, 5173, 8000, 9324–9325, 1025, and 8025 must be available.

## Delivery-log privacy

Recent emails and message details expose delivery metadata only: sender, recipients, subject, reply-to, status, timestamps, send attempts, provider ID, and delivery events. The admin detail API uses an explicit allowlist and never returns HTML/plain-text bodies or internal sending payloads, including for previously stored messages. Public email retrieval also omits bodies and free-form provider event diagnostics. Unknown error text is replaced with a generic message in the dashboard. Delivery-log responses use `Cache-Control: no-store`.

Email HTML and plain text are stored only while queued or being submitted. Narada removes them in the same database update that records provider acceptance (or local Mailpit capture), permanent failure, expiry, or an uncertain outcome that will not be retried. Retriable throttling retains content until a later attempt completes or expires. Delivery feedback also removes content, including when it arrives before submission finishes. Per-recipient broadcast unsubscribe URLs are removed with the body; delivery metadata retains the existing 30-day TTL. Expired messages are cleaned up even when sending is paused, once the worker processes them.

Existing completed records need a one-time cleanup after deploying this behavior; see [message content retention and cleanup](docs/MESSAGE-RETENTION.md). Purging live records does not erase previous database backups, exported copies, the recipient inbox, or local Mailpit captures. Do not put credentials in subjects or address fields; those remain visible metadata. Consumer applications should use short-lived, single-use authentication links and codes.

## Broadcasts and audiences

Open **Audience** for Contacts, Properties, Segments, and Topics. Create a mailing list and import opted-in contacts from CSV or pasted email addresses. Record the consent source and any topic opt-ins; imports never reverse an unsubscribe. Custom properties support personalization, and dynamic segments select contacts with property rules. Then open **Broadcasts** to create a draft, choose an audience, compose with the visual block editor (or edit HTML/plain-text source), and provide your organization/postal address for the footer.

Use **Send test email** to check a single message in Mailpit, then **Review & send** to send now or schedule. The review shows eligible and excluded recipients. Every recipient gets a separate email and unsubscribe link. You can cancel unsent work and duplicate existing broadcasts.

The initial limit is 1,000 contacts per audience, with a 250 KB contact-storage limit. This uses the existing DynamoDB tables, SQS workers, and SES transport; no additional cloud service or database is required. See [broadcast behavior, limits, and local testing](docs/BROADCASTS.md).

## Forms

Open **Forms** to create a client intake, feedback, or signup form. Build and reorder questions, customize branding, preview the one-question-at-a-time experience, and publish a shareable link. Responses retain their original form version and can be reviewed or exported as CSV. Create a broadcast invitation directly from a published form.

Optional contact sync requires email confirmation before updating profiles. Signup forms capture explicit consent for a public topic and preserve unsubscribe choices. Optional acknowledgment emails use Narada’s existing delivery queue. See the [Forms guide](docs/FORMS.md) for setup, limits, processing behavior, and local testing.

## Domains

**Domains** has a searchable list with status filters and pages of 20 domains. Choose **Add domain** for a guided setup with a live sender preview, then open a domain to review its DNS records. Copy individual record names/values or all records together, and click **Check verification** after publishing them with your DNS provider. Verification runs only on request. The region is fixed by your deployment, so it is shown as information rather than an editable selector.

Each domain has a four-step **Domain setup** checklist:

1. **DKIM:** Inspect SES signing status separately from identity verification, copy DNS records, and enable signing if disabled.
2. **DMARC:** Inspect the published policy (including organizational-domain inheritance), generate a proposed monitoring policy and optional report address, and publish it through your DNS provider. Existing policies are shown and never overwritten automatically.
3. **MAIL FROM:** Optionally configure a dedicated bounce subdomain directly in SES from Narada. Copy the required MX/SPF records and choose fallback to SES or rejection when MX verification fails. Do not replace the MX records for an ordinary inbox.
4. **Test email:** Queue a message to an inbox you control. Locally, inspect Mailpit; in AWS, inspect the received message headers for SPF/DKIM/DMARC. SES sandbox recipient restrictions still apply. Delivery is not proof of inbox placement.

**Check verification** refreshes SES and public DNS on demand. DNS timeouts show an unknown result, not a missing policy. DMARC checks cover discovery and common syntax; they do not validate report-mailbox authorization or every extension. SPF checks compare a dedicated SES record rather than evaluating arbitrary SPF policies. Local mode saves clearly labeled previews without contacting SES or public DNS. Re-deploy an existing installation to grant the new SES configuration permissions. See the [domain authentication guide](docs/DOMAIN-AUTHENTICATION.md).

Open a domain and choose **Remove domain** to remove it from Narada. Type its exact name to confirm. New sends are rejected, and queued messages fail when the worker checks the removed domain; submissions already in flight cannot be recalled. Email history is retained. The SES identity and DNS records remain because other applications may use them. Scoped keys remain registered and can send again if you deliberately re-add the domain. Domain names are immutable: add a replacement domain instead of renaming one.

Local domains are labeled **Local only**, capture email in Mailpit, and require no DNS changes. They are separate from verified AWS identities. New domains record their creation date, region, and last check; older records without a creation date show **Not recorded**. Narada does not write DNS records or configure inbound email in this flow.

## Settings

Settings is organized into three keyboard-accessible tabs:

- **Amazon SES** shows deployment configuration, account access/sending status, quotas, and the configured delivery pool. In local mode it shows Mailpit capture information and never contacts AWS. AWS readings are cached for up to 30 seconds; missing values remain unavailable.
- **Sending** pauses/resumes application submissions and queued jobs and explains current retry/expiry behavior. Authentication password-reset mail uses a separate path. Automatic quota pacing and domain warm-up schedules are not implemented yet.
- **Recipients** manages suppressions with search and manual add/remove controls. Audience subscription preferences remain in Audience.

**Profile → Security** contains password changes, a verified-domain recovery sender selector, a reset-link button, authenticator enrollment, and **Connected apps**. The saved sender also powers the login screen’s forgot-password flow. See [profile and account security](docs/PROFILE-SECURITY.md) for setup, sandbox requirements and recovery behavior. This is implemented locally and requires deployment to become available on an installation.

SES account information is read-only. AWS Region, configuration set, and pool provisioning remain deployment concerns; this page does not create paid IP pools or modify AWS resources. The API role needs `ses:GetAccount` and `ses:GetConfigurationSet`, included in the CDK stack. Existing AWS deployments need a redeploy to receive these permissions.

## Agent access through MCP

Add `https://<your-narada-host>/api/mcp` as a remote HTTP MCP server. Sign in with Better Auth, choose all requested or selected permissions, and optionally restrict access to existing forms, publications and sending domains. Shared product operations and identity/capabilities enforce those restrictions on lists, direct access and retries. Use server discovery for the operations available to your grant. Every mutation requires an idempotency key. See [MCP setup, connection lifecycle and rollout](docs/MCP.md).

## Metrics and webhooks

**Metrics** reads daily aggregates from DynamoDB. It loads once when opened; choose a sender domain and period, then click **Fetch metrics** to refresh. There is no polling and no CloudWatch metrics API call. In AWS mode, **Open CloudWatch** opens the regional AWS console. The existing SES → SNS → SQS feedback pipeline updates the aggregates; DynamoDB/queue/worker usage still has normal AWS charges, but no extra database, event bus, or metrics service is added.

Counts are recipients per message, with each outcome counted once even if SES delivers duplicate notifications. Daily charts group messages by their UTC acceptance date, so later feedback updates that original day. Rates are outcomes divided by Narada-accepted recipients, including queued messages: they are **not** SES account reputation rates or inbox-placement measurements. Local captures and simulated feedback are explicitly labeled. Tracking starts with new messages; older messages and direct authentication emails are excluded. Aggregates remain after the 30-day raw message retention period.

**Webhooks → Add webhook** lets you search and select email, contact, topic, domain, suppression, form response, issue publication, and broadcast completion events. Edit an endpoint to change its URL or subscriptions. Existing endpoints keep their five original email event types. New event types are not silently added to subscriptions. Changes apply to future events; already queued deliveries retain their original selection. Signing secrets are returned only on creation. See [event catalog, delivery semantics, and local testing](docs/WEBHOOKS.md).

For a local test, click **Use local test receiver**, choose `email.bounced`, send a local email, then simulate a bounce from its details. Delivery history shows the event type, result, paginated attempts, and retries without losing earlier attempts. The receiver is `http://localhost:3001/api/dev/webhook-receiver`; port 5173 is the frontend, not a webhook receiver.

## Validate

```sh
pnpm check                       # TypeScript, unit tests, frontend build
pnpm test:integration             # Real DynamoDB + Better Auth + Mailpit
pnpm exec playwright install chromium
pnpm test:e2e                     # Starts dev if it is not already running
pnpm infra:check                  # Synthesizes locally; never deploys
pnpm format:check
```

Integration tests use separate `narada-integration-*` tables. Browser tests use the local owner account and leave clearly named test messages in the local dashboard. Tests cover concurrency, idempotency conflicts, uncertain sends, suppression, event ordering, rate limiting, real authentication, MFA, reset-token reuse, browser interactions, and signed webhooks.

## Deploy to AWS

Copy `narada.deploy.example.json` to ignored `narada.deploy.json` and fill in your AWS accounts, profiles, region, owner email and password-reset sender. See the [AWS operator walkthrough](docs/SELF-HOSTING.md). No source edits or account-specific test changes are required. The installer fails closed when deployment configuration is absent. Offline infrastructure checks can use example values, but deployment requires your own configuration.

Sign in with AWS CLI/SSO, then preview staging:

```sh
aws sso login --profile narada-staging
pnpm run deploy --stage staging --plan
```

Use **`pnpm run deploy`**, not `pnpm deploy`: pnpm has its own built-in command named deploy. The deployment script requires an explicit stage (`staging` or `production`; `prod` is an alias). It checks STS identity before changing secrets or infrastructure. An incorrect account is rejected, including the organization's management account. SDK calls and CDK use the selected profile; ambient access-key environment variables are not forwarded to CDK.

`--plan` runs type/unit/build and infrastructure checks, then a template-only CDK diff. It does not create parameters, publish assets, bootstrap CDK, or invoke owner setup. Template-only diffs cannot predict every resource replacement as accurately as a CloudFormation change set. Review the output and IAM changes before applying:

```sh
# First deployment to staging; --bootstrap creates the account/region CDK toolkit.
pnpm run deploy --stage staging --bootstrap

# After validating staging, preview and deploy production.
aws sso login --profile narada-production
pnpm run deploy --stage production --plan
pnpm run deploy --stage production --bootstrap

# Subsequent releases use the same commands without --bootstrap.
pnpm run deploy --stage staging
pnpm run deploy --stage production
```

The script builds and checks the stack, creates an SSM SecureString auth secret only if absent, deploys the application and frontend, and invokes an IAM-only owner bootstrap function. CDK asks for confirmation of broadened IAM permissions. Production stack termination protection and deletion protection on both DynamoDB tables prevent accidental deletion. Resources and secrets are isolated by account and stage. Synthesized assemblies use `cdk.out/<stage>`.

Outputs and generated owner credentials are saved under `.local/` with **account, region, and stage** in the filename, for example `.local/aws-owner-111111111111-ap-southeast-2-staging.json`. Credentials are written with owner-only file permissions. The deploy command prints the file path, not the password. Keep credentials and `/narada/<stage>/auth-secret` secure; preserve them across deployments. Bootstrap does not reset an existing owner's password. Never commit `.local` or `.env.local`.

The default frontend uses private S3 and CloudFront, with `/api/*` routed to API Gateway. Sign in at the emitted CloudFront URL, then add and verify the sender domain. Publish DKIM/DMARC and any MAIL FROM records through your DNS provider. Request SES production access separately in each account/region where real recipient sending is needed. Initial sandbox restrictions are visible in Settings. Choose a verified recovery sender in **Profile → Security**, or verify the deployment `AUTH_FROM` identity before relying on password-reset mail. Lambda functions use IAM roles; no SES access keys are stored in Narada.

### Deployment validation and recovery

Complete the [SES onboarding checklist](docs/SES-ONBOARDING.md) in each target account/region. It includes recipient-verification and production-access CLI commands, DNS-provider checks, and rejected-test troubleshooting. AWS approval and inbox confirmation are operator steps outside CDK/CI.

Run `pnpm deploy:smoke --stage staging` (or `production`) for the deployed frontend, API, secure owner session, admin-read, and SES-status checks. This creates and signs out a temporary owner session, saves a report under `.local/`, and sends no email. It uses the locally saved bootstrap password; after changing that password, use your current credentials for manual verification instead.

For each account: verify HTTPS/dashboard loading and health, confirm anonymous admin requests are rejected, sign in with the owner, inspect SES settings, then validate verified-recipient or simulator delivery, event ingestion, and webhook delivery after sender verification. Do not treat successful infrastructure deployment as SES production approval or proof of inbox placement. Validate staging before changing production.

Keep the tested Git revision and deployment outputs for each release. To roll back application code, redeploy a compatible previous revision using the same stage/account configuration after inspecting its diff. Database schema changes need a separate migration/recovery decision. Never purge queues or replay uncertain sends as part of application rollback: accepted emails may already have reached SES. Review dead-letter messages before redriving them.

Both DynamoDB tables have point-in-time recovery and are retained on stack removal. Restores create new tables; a recovery procedure must restore stream/TTL/PITR settings, adjust IAM and application table references, and reconcile queued work before restarting sends. A live restore drill is still required. The existing dead-letter alarms do not yet have notification subscribers; alert routing, billing budgets, automated quota pacing, remain follow-up operations work; custom app hostnames are supported through the [custom-domain runbook](docs/CUSTOM-DOMAIN.md). Narada's metrics use DynamoDB rather than CloudWatch polling.

### GitHub Actions releases

The repository is [Durga-Digital/narada](https://github.com/Durga-Digital/narada). Pull requests run `.github/workflows/ci.yml`: type checks, unit tests, SDK/frontend builds, CDK assertions, DynamoDB integration tests, and Playwright browser tests against Docker services. PR jobs have no AWS credentials. Actions are pinned to commit SHAs.

Pushing `main` runs **Release Narada**, validates the revision, deploys staging, and checks the deployed frontend/API. Production is skipped on push. Release deployments are serialized and are not canceled mid-deployment when a newer commit arrives.

#### Deploy production manually

1. Open [GitHub Actions → Release Narada](https://github.com/Durga-Digital/narada/actions/workflows/release.yml).
2. Click **Run workflow** and select the **main** branch.
3. Enable **Deploy this main revision to production after staging passes** (`deploy_production`). It is off by default.
4. Click **Run workflow** to start the release.
5. Open the new run and check that **validate → staging → production** all succeed, including the deployment smoke checks.

This starts a new run of the same release workflow. Production is a separate job within that run; there is no later **Approve deployment** pause. The manual run checks and deploys its own selected `main` commit to staging first, then deploys that same commit to production. It does not promote an older staging run automatically. If validation or staging fails, production does not start. Leaving the production option off runs validation and staging only.

Equivalent GitHub CLI command (this starts a production release):

```sh
gh workflow run release.yml --repo Durga-Digital/narada --ref main -f deploy_production=true
```

#### Release permissions and maintenance

Configure both GitHub environments to allow only `main`. Production uses explicit manual dispatch. Repository writers who can run workflows can initiate a release; configure additional environment protections where available. Do not assume a reviewer approval gate exists.

AWS authentication uses short-lived [GitHub OIDC credentials](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws); no AWS access keys or Narada owner passwords are stored in GitHub. The trust policies pin the configured exact repository subject and environment. Use the actual OIDC subject for your repository; wildcards are rejected. GitHub branch restrictions are part of this trust boundary. Deployment roles can assume the account's CDK bootstrap roles, whose CloudFormation execution role has administrative privileges; treat workflow and infrastructure changes as privileged code.

The OIDC providers and roles are managed separately in `infrastructure/github-stack.ts`. Initial AWS bootstrapping, auth-secret creation, and owner creation remain operator tasks through the normal local deployment command. `--ci` only updates an existing installation, never creates or resets the owner or auth secret. CI smoke checks use `--public` and do not test owner login or email delivery; use the full local smoke command when those credentials are available.

The delivery role needs `dynamodb:DescribeTable` on its own stage's auth table so the installer can wait for lookup indexes to become active. This grants metadata access only. Update an existing delivery stack with the commands below before using that readiness check in CI; application deployments do not update delivery roles. This infrastructure permission does not change product API, SDK, or MCP permissions.

To provision or update delivery access using an authenticated operator profile:

```sh
NARADA_STAGE=staging pnpm exec tsx infrastructure/github-bin.ts
pnpm exec cdk deploy NaradaDelivery-staging --app cdk.out/github-staging --profile narada-staging
NARADA_STAGE=production pnpm exec tsx infrastructure/github-bin.ts
pnpm exec cdk deploy NaradaDelivery-production --app cdk.out/github-production --profile narada-production
```

Deployment is disabled until the repository variable `NARADA_DEPLOY_ENABLED` is `true`. Set these **repository-level Actions secrets** (Settings → Secrets and variables → Actions):

| Staging                      | Production                      | Value                       |
| ---------------------------- | ------------------------------- | --------------------------- |
| `NARADA_STAGING_ACCOUNT_ID`  | `NARADA_PRODUCTION_ACCOUNT_ID`  | Target AWS account ID       |
| `NARADA_STAGING_OWNER_EMAIL` | `NARADA_PRODUCTION_OWNER_EMAIL` | Existing Narada owner email |
| `NARADA_STAGING_AUTH_FROM`   | `NARADA_PRODUCTION_AUTH_FROM`   | Password-reset sender       |

The release workflow explicitly passes only the selected stage's three configuration secrets to the reusable deployment workflow. Environment secrets are unavailable for private repositories on GitHub Free, even if they can be configured through the API; do not rely on them. These configuration secrets are not AWS credentials. AWS authentication still uses OIDC. Repository secrets are accessible to eligible repository workflows, so protect workflow edits accordingly.

In each GitHub environment, set the variable `AWS_REGION`. Optional environment variables `NARADA_CUSTOM_DOMAIN` and `NARADA_CERTIFICATE_ARN` configure HTTPS. Keep staging and production values separate. Production still requires a manual release; this is not an environment reviewer approval gate.

For delivery-role provisioning, supply `NARADA_GITHUB_REPOSITORY` (`owner/repository`) and `NARADA_GITHUB_SUBJECT_PREFIX` (the exact `repo:...` prefix before `:environment:<stage>`). Configure this from your repository's OIDC settings; never copy another repository's trust. Set `GITHUB_OIDC_PROVIDER_ARN` when reusing an existing provider. Never upload `.local/`, owner credentials, or auth secrets as workflow artifacts.

## Repository

```text
apps/web/          React + shadcn UI, feature screens, shared hooks/API client
apps/api/          Hono HTTP adapter; local, Lambda, owner bootstrap entrypoints
apps/worker/       Shared queue handlers; local loops and Lambda adapters
packages/core/     Domain rules, DynamoDB, auth, transports, queues, webhooks
packages/sdk/      Small TypeScript HTTP client
infrastructure/   AWS CDK stack
scripts/          Local lifecycle, deployment, infrastructure assertions
tests/            Unit, database integration, and Playwright browser tests
docs/             Product scope and architecture/operations decisions
```

See [the PRD](docs/PRD.md), [architecture and operational notes](docs/ARCHITECTURE.md), and [API contract](docs/API.md).

## Cost expectations

At 1,000 emails/month, SES outbound email alone is approximately **US$0.10**, before data charges. The rest depends on region, traffic, free-tier eligibility, retained storage/backups, dashboard polling, logs, and alarms. A low single-digit monthly bill is the design target, not a guaranteed quote. This architecture removes the always-on database/server costs that would undermine the savings at this volume. See [SES pricing](https://aws.amazon.com/ses/pricing/) and [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/).

The two dead-letter queue alarms incur normal CloudWatch charges. Set an AWS billing budget for your account and attach notification actions to these alarms if you want operational alerts. SES sandbox sending limits still apply until AWS grants production access.

### Programmatic access

For time-sensitive authentication hooks, see [Submission latency and diagnostics](docs/SUBMISSION-LATENCY.md) for the acceptance boundary, safe measurements, request correlation, and rollout checks.

Install the Node.js SDK with `npm install @durgadigital/narada`. The SDK and application source are licensed under Apache 2.0. Previously published MIT versions retain their original license; this source change does not publish a new npm version.

For an agent-assisted setup, open **Integrate an app** in the dashboard. Choose **Migrate from Resend** or **Connect a new app**, optionally enter your sender address, and copy the prompt into your coding agent. It includes the current installation's origin, SDK/API contract, retry behavior, and migration checks. Supply `NARADA_API_KEY` separately in the consuming app's server environment; the prompt does not fetch or include keys. Open this page in the intended staging or production installation before copying.

#### Publishing the SDK

SDK publishing is independent of AWS deployment and disabled unless the repository variable `NARADA_SDK_PUBLISH_ENABLED` is `true`. Forks should leave it disabled unless publishing their own renamed package. PR/main validation builds and tests the actual npm archive in an isolated consumer project, including its ESM entry point and TypeScript declarations. The archive is restricted to compiled SDK files, declarations, README, license, and package metadata.

To release a new SDK version:

1. Update `packages/sdk/package.json` to a new stable version, update documentation, and merge to `main`.
2. Open **Actions → Publish Narada SDK → Run workflow**, select **main**, and enter that exact version. Alternatively, push a tag such as `sdk-v0.1.1` pointing to a commit already on `main`.
3. Check that package validation, publishing, and public registry verification succeed. Normal pushes to `main` do not publish npm versions.

The workflow uses the repository secret `NPM_TOKEN`, exposed only to the publish step as `NODE_AUTH_TOKEN`. Use a granular npm token with write permission for the `durgadigital` scope/package and CI-compatible 2FA bypass, subject to organization policy. Initial publishing requires permission to create the package. Rotate the secret when the token expires. The workflow publishes the exact tested tarball with lifecycle scripts disabled. An existing version cannot be overwritten: if a run fails after uploading, inspect npm before retrying or bumping the version. Trusted publishing can replace the token later; it is not enabled by this workflow.

Registry verification waits up to roughly five minutes for npm's processing delay and compares the published archive's integrity with the tested tarball. A rerun skips uploading an already-public version only when the contents match exactly; different contents require a new version.

Run `pnpm sdk:check` locally to validate the archive without publishing or sending email. The package repository metadata links to the source repository.

Open **API keys → Create API key** to name a credential, choose Sending, Scoped, or Full access, and copy its token once. Scoped keys combine only the required permissions across emails, contacts, properties, segments, topics, broadcasts, and templates. For signup hooks, choose `contacts:create`. Use **Edit** to change an active key’s name, permissions, or domain restriction without replacing its token; changes apply to the next authenticated request. Sending access and scoped email permissions can be limited to one domain already added to Narada; the restriction applies to both sending and retrieving email status, with subdomains treated separately. All other scopes, including broadcast sending and template tests, apply across the workspace. Full-access keys operate across the workspace. The list supports search, permission/status filters, and exact-name confirmation before revocation. Revoke a key to disable authentication, then choose **Delete** and type its name again to permanently remove its metadata. Active keys cannot be deleted; email history remains.

**Last used** records authenticated API activity, including requests that later fail input validation or resource lookup. Timestamps update at most once per minute per key and are best-effort metadata, not an audit log. Click **Refresh keys** for the latest values. Older keys show **Not recorded** until they are used again; historical activity is not reconstructed. Revocation blocks new authenticated requests but does not cancel emails already queued.

Use the **API reference** page or `</>` buttons in Broadcasts and Audience for cURL and Node.js examples. Use **Scoped access** to select the read, write, membership, subscription, import, and sending operations your app needs, or **Full access** for the existing audience, broadcast, template and email APIs. Existing keys retain email-only permissions. Sending never creates contacts or grants consent. Membership additions require no consent assertion and preserve subscriptions, opt-outs, and suppressions. Broadcast permission is checked separately; membership alone never grants it. The typed, dependency-free [Node SDK](packages/sdk/README.md) is distributed as `@durgadigital/narada` on npm and can also be packed locally. See the [HTTP API guide](docs/API.md) for endpoints, pagination, permissions, revisions, and retries.

Email sends accept validated `tags` metadata and `priority: "normal" | "high"`. Tags appear in status responses, email details, and exact key/value filters within the dashboard's latest 100 messages. High priority adds inbox hints without changing queue order; inbox clients decide whether to display them. See the [send contract](docs/API.md#send) for limits and a migration example.

### Product operations API

Forms, publications and issues have typed public endpoints and SDK methods, including response exports, previews, publishing and delivery results. Provision an explicit **operation key** with granular scopes and optional form/publication/domain restrictions through the owner key API. Existing full/scoped keys do not gain these permissions automatically. See the [product API guide](docs/PRODUCT-API.md) for provisioning, resource rules and endpoint coverage.

### Reusable templates

Open **Templates** for a searchable library, starter designs, shared block/source editor, typed variables, previews, and local test sends. Publish immutable versions, reuse them through the Node SDK or create an independent broadcast draft. See the [Templates guide](docs/TEMPLATES.md).

If the dashboard reports an incomplete response, use **Try again** for list reads. For a create, revoke, or delete request, refresh the list before retrying: the server may have saved the change before the response was lost. Mutations are never automatically retried.

See [Safe retries and idempotency](docs/IDEMPOTENCY.md) for API/SDK retry contracts and recovery from uncertain operations.

### Newsletters

Use **Newsletters** to create a free publication, activate its verified sender and share its subscribe page. Readers confirm their address before becoming eligible for that publication. Write issues with the shared editor, preview or send a test, then publish to the web, email, or both immediately or on a schedule. Public corrections never resend email; withdrawal removes an article from the archive while preserving delivery history. See the [newsletter v1 plan](docs/NEWSLETTERS-V1.md) for scope, limits and release checks.

The **Image** button opens a shared library for newsletters, templates and broadcasts. Upload PNG, JPEG or GIF files up to 3 MB and 16 megapixels, then provide alt text when inserting them. Images use permanent public URLs so readers can load them from sent emails. Each environment owns a private, retained S3 bucket, served through CloudFront at `/media/*`; frontend deployments cannot prune these files. Local development uses `.local/media` (override with `MEDIA_DIRECTORY`). The reusable `MediaService` and `MediaStorage` interface live in `packages/core/src/media.ts`; the API handles owner-authenticated uploads and paginated browsing at `/api/admin/media`. Uploads validate file signatures and dimensions; they do not decode or resize images. Identical files reuse the same content-addressed object.

Use **YouTube** to insert a video block, or paste a standalone YouTube URL into an empty newsletter paragraph. Published web issues use the privacy-enhanced YouTube player; emails use a linked thumbnail and text link. Templates and broadcasts insert that email-compatible fallback directly. Video embedding must also be enabled by the video's owner.

### Activity and operation status

Open **Activity** to inspect recorded mutations and recovery guidance. Connected apps links to each client’s activity. API/MCP status tools require the explicit `narada:operations:read` permission and enforce the caller’s current resource access. See [Activity and operation recovery](docs/ACTIVITY.md) for lost-response lookup, retry rules, retention and coverage.

### Operational API and MCP

Sending status and pause/resume, metrics, SES and domain diagnostics, suppressions, and webhook management have shared API, SDK and MCP operations. These additions are deployed to staging and production. Use explicit operation-key scopes or fresh OAuth consent; existing grants do not expand automatically. See [Operational API](docs/OPERATIONAL-API.md) for permissions, restrictions, SDK examples and recovery.

Contacts/properties, topics, segments, templates and broadcasts also have [shared REST/MCP operations](docs/CAMPAIGN-MCP.md), alongside transactional email and approval tools, bringing the MCP inventory to 104 tools before permission filtering. Existing scopes distinguish reading, drafting, testing, sending, cancellation and consent changes. This increment is deployed to staging and production.

MCP OAuth sends and issue publication require a [human approval workflow](docs/SEND-APPROVALS.md). This checkout restores automatic API-key/SDK sending within existing permissions; no key or auth-hook migration is needed. The correction is pending deployment: the 2026-10-24 deployed release still requires API-key approval.

The backend can also be composed as private ESM modules or run as a standalone REST server and worker. See [backend modules and hosting](docs/OPERATION-CONTRACTS.md#backend-modules-and-independent-hosting) for build checks, configuration, and migration constraints.

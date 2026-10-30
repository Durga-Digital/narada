# Shared operation contracts and authorization

Shared contracts cover the current public v1 API, production OAuth MCP product operations, and the deployed [operational API](OPERATIONAL-API.md) and [operation-status](ACTIVITY.md) additions. REST authenticates API keys; MCP uses delegated OAuth.

## Contract ownership

`packages/contracts` is browser-safe and has no AWS, database, Node runtime, or core-service dependency:

- `operations.ts`: stable operation IDs, exact HTTP bindings/statuses, delegated scope requirements, effects, idempotency behavior and resource policy.
- `scopes.ts`: granular delegated scopes and consent labels. Sending does not grant status reads; broadcast send, test and cancel are separate; template draft, publish and archive permissions are separate.
- `legacy-access.ts` and `legacy-scopes.ts`: the frozen compatibility map for existing keys. Each group of alternatives must be satisfied. Full keys are limited to that map; adding a catalog entry does not grant existing keys access.
- `types.ts` and `operation-types.ts`: canonical DTOs and typed input/output envelopes. Inputs contain only path parameters, query and body, never caller identity or delegation.
- `operation-schemas.json`: generated structural JSON Schemas for those envelopes/results. `discovery.ts` generates OpenAPI 3.1 from them and the operation catalog. Domain validation remains in core, including consent, bounds, sender verification, revision checks and content validation; these schemas do not replace it.
- `mcp.ts`: the implemented MCP operation inventory, tool names and supported consent scopes, including conditional form side effects.
- `delegation.ts`: validated scope/resource selection. “All” means the supported scopes in this authorization request at approval time, never a wildcard that expands later. OIDC session scopes are managed by the OAuth provider, separately from product scopes.

Run `pnpm contracts:generate` after changing a contract. It regenerates portable JSON Schemas and the SDK's self-contained type file. The schema generator uses the pinned TypeScript 7 compiler API; it fails on unsupported type constructs. `pnpm contracts:check` detects drift and runs as part of `pnpm check`. Do not edit generated files manually. The SDK keeps its existing import path and has no new runtime dependency.

The public API exposes authenticated, uncached discovery:

- `GET /api/v1/capabilities`, also `sdk.capabilities()`: contract/API versions, environment, permission model, current scopes/restrictions, permitted operation descriptors and pagination limits.
- `GET /api/v1/openapi.json`: generated OpenAPI containing only this caller's permitted REST operations. `x-narada-delegated-scopes` describes required scopes, `x-narada-any-scopes` describes alternatives, and issue publishing includes `x-narada-channel-scopes`; authentication remains an API key and legacy authorization uses the frozen map.

These metadata operations are available to every legacy API key; operation keys require `narada:capabilities:read`. Discovery is advisory: execution always checks authorization again. Restricted email operations still require a matching resolved sender even when listed in discovery. The MCP adapter in this checkout advertises 104 tools (32 product, 20 operational, 42 audience/campaign, three status, three approval, two transactional email and two metadata), filtered by current authorization; the isolated probe retains its two metadata tools.

## Server boundary

`packages/core/src/authorization.ts` contains the shared policy evaluator. Authentication adapters create an opaque request-local `Caller` after authentication. The caller's identity, effective scopes and restrictions are kept in a private WeakMap; accepting JSON shaped like a caller or deserializing an old handle cannot grant authority.

`apiKeyCaller` receives the fresh authenticated key record. `oauthCaller` receives verified token identity and freshly loaded durable grant/consent records, checks the user/client/resource and grant generation, and intersects token, grant and consent scopes. Signature, issuer, audience and expiry verification remain the OAuth authentication adapter's responsibility. `ownerCaller` is available for verified owner sessions; existing dashboard authentication/origin checks remain in place.

Use `assertOperationAccess` before parsing or resource lookup. This checks scopes and whether the selected restrictions can be supported. It is **not** the complete check for restricted resources. Use `authorizeOperation` with server-resolved resource facts before disclosure, replay or mutation. `executeAuthorized` combines the two stages around a read-only resolver and an execution callback, and is used by the MCP probe. REST middleware authorizes catalog operations before its idempotency wrapper; the specialized email paths check the resolved sender before returning a message or calling email acceptance/replay.

The authorization layer grants no account-security or credential-management operation. Unknown operations fail closed for every caller. Full-key HTTP requests retain the existing 404 response for unknown routes, including a newly registered handler that lacks a catalog entry; scoped/sending keys retain 403.

Compound delegated operations require all listed scopes: creating a broadcast from a template requires template read plus broadcast write; duplication requires read plus write; CSV import requires contact import, segment-membership write and subscription write. Legacy compound/broad scopes retain their previous meaning through the compatibility map.

## Product operations and restrictions

`SharedOperations` dispatches to `ProductOperations` for forms, publications and issues, to `OperationalOperations` for sending, metrics, diagnostics, suppressions and webhooks, and to `CampaignOperations` for contacts/properties, topics, segments, templates and broadcasts, and to `EmailOperations` for transactional email send/status. All use shared input-schema validation. Campaign REST routes are generated from the catalog and use exactly the same handlers as MCP. `OperationalService` also serves the matching dashboard mutations. The HTTP adapter derives routes from the catalog. Production MCP tools call the same `prepare`/`run` boundary with a verified OAuth caller. `prepare` authorizes the current parent, child, immutable form version, linked issue broadcast, proposed sender and channel-specific permission **before receipt lookup**. `run` retains domain validation and revision/transaction guards. `authorizeReplay` must also run on stored responses: a receipt's historical sender may differ from the current resource. Do not retain a prepared operation or caller across requests.

Operation keys explicitly opt into granular scopes using `permission: "operations"` and `operationAccess: { scopes, resources }`. Existing sending/scoped/full keys retain their target capability ceiling. The approval request/list/get endpoints are the explicit compatibility exception: they let legacy keys request review only for already-permitted target actions, without granting new product access. The session-authenticated owner key API provisions and updates operation grants, validates selected resources, and exposes no credential-management operation to agents. See [product API and provisioning](PRODUCT-API.md).

Restrictions are intersections, never unions. Selected form IDs filter forms; selected publication IDs filter publications, their issues and their managed forms. Supplying both dimensions restricts forms to the intersection and denies operations that cannot support both. Sender domains constrain existing and proposed senders, historical form-response versions and linked issue deliveries. Creating new root forms/publications requires an unrestricted ID dimension. Generic contacts/topics/segments/broadcasts cannot be used by an ID-constrained grant to bypass managed-resource boundaries. Independent form invitation broadcasts require unrestricted ID dimensions.

Collection authorization occurs before DTO projection. Bounded GSI queries are followed by consistent primary-record reads, so stale index copies cannot disclose an old sender/resource. Cursors are authenticated, encrypted and bound to a collection/parent; they confer no access and are re-filtered on every request. Product lists accept 1–20 records, default 20. A scan budget can produce an empty page with a next cursor; follow until `null`. Response export returns bounded CSV chunks (up to five responses) in JSON with a next cursor. Existing audience/campaign REST pagination remains 1–100; the corresponding MCP handlers enforce 1–20, default 20. These existing v1 cursors retain their format.

Form definitions do not include answers. Response read/export/retry, publication subscriber reads, issue tests, web publish, email distribution, withdrawal and delivery results have separate permissions. `issues.publish` accepts either web or email permission at discovery, then requires the exact requested channel set at execution. Contact-syncing forms also require contact create/update, sending and, when configured, subscription-write scopes. Publication lifecycle permissions cover the publication's own managed signup/topic/audience resources; they do not authorize generic access to other resources. Publishing and consent rules in domain services remain enforced.

All new mutations accept idempotency keys. Their terminal writes and projected public receipts commit atomically; internal DynamoDB attributes, response verification tokens and managed broadcast IDs are excluded from these DTOs and receipts. Webhook creation explicitly returns its signing secret; authorized same-key replay may return that creation result while the endpoint and secret remain current. Ordinary reads, delivery history and activity never return it. Issue creation, editing, tests and publishing bind the authorized publication revision. REST receipt namespaces remain unchanged.

[Production MCP](MCP.md) now adds Better Auth OAuth, all/selected scope and resource consent, connected-app reductions/revocation, and required mutation retry keys using the shared receipt coordinator. Fresh consent rotates the durable grant generation. Existing grants never gain newly defined scopes automatically. Durable mutation activity, the owner Activity UI and authorized operation lookup are deployed to staging and production; see [Activity and recovery](ACTIVITY.md). Operational coverage, [audience/campaign MCP tools](CAMPAIGN-MCP.md) and lifecycle webhooks are also deployed to staging and production.

Validation covers the product lifecycle through the real SDK/HTTP/DynamoDB stack, every successful SDK output against its generated schema, legacy-key ceilings, filtered pagination, direct and linked-resource access, form answer/export permissions, channel-specific publishing, integration permissions, live permission reduction and historical receipt senders. Shared-handler tests also exercise a verified OAuth caller. OAuth integration tests retain refresh, consent-reduction and reconnect coverage.

## CI enforcement

Run `pnpm contracts:verify` before submitting contract changes. CI checks generated artifacts, typed SDK bindings and wire requests, complete MCP coverage, and the packed SDK. See [contract CI](CONTRACT-CI.md) for exclusions, contribution steps and required status checks.

MCP OAuth sends and issue publication require [owner approval](SEND-APPROVALS.md) at the shared execution boundary. The three approval operations share contracts across REST, SDK and MCP; owner decisions are deliberately excluded from all machine-client interfaces. CI checks that every MCP send operation has an approval input matching its canonical operation input.

The shared execution boundary now distinguishes verified caller kinds: API-key sends are unattended within existing scopes, while OAuth MCP sends require owner approval. The compatibility correction was verified on the maintained staging and production installations on 24 October 2026; each independent installation must deploy and verify its own revision. No input/output schema or SDK method change is required; the transactional description now states both policies. See [compatibility](SEND-APPROVALS.md).

## Backend modules and independent hosting

The backend builds as seven private ESM packages with declarations. The existing
Lambda deployment consumes these modules; standalone entrypoints are optional
and do not create a separately hosted service or a published package release.
The public SDK remains `@durgadigital/narada`; its endpoint paths and DTOs are unchanged.

- `@narada/contracts` owns operation IDs, HTTP bindings, schemas and permissions.
- `@narada/core` exports `Application`, `Caller`, `createServices` and runtime
  types. `Application.execute` binds inputs/results to the canonical operation
  types. `executeUnknown` is the adapter entry for untrusted JSON.
- `@narada/runtime-aws` supplies `createRuntime` and the AWS/SSM bootstrap.
  `createServices` accepts explicit storage, queues, mail, media, domain and auth
  dependencies. DynamoDB transaction primitives and the existing provider
  implementations remain in core; this extraction does not claim database or
  JavaScript-runtime independence.
- `@narada/http-api` exposes `createPublicApi`, `restRoutes`, `ownerRoutes`,
  `publicContentRoutes` and the legacy combined HTTP composition.
- `@narada/mcp` owns MCP and OAuth HTTP adapters, schemas and protocol formatting.
- `@narada/api` and `@narada/worker` provide Node and Lambda entrypoints; workers
  retain existing queue payloads and dispatch/recovery behavior.

REST and MCP call the same application executor. It authorizes current resources
before receipt lookup, reauthorizes historical results before replay, and couples
mutation results with the existing receipt/activity transaction. It preserves
REST method/path receipt identities, raw query digests, OAuth operation-ID
identities, and the specialized email acceptance receipt. Authentication,
request-size limits and transport rate limits stay in their adapters. Direct
server callers must authenticate each request and supply a fresh trusted caller;
this package is privileged server code, not a sandbox for untrusted extensions.
Do not pass JSON into caller constructors or share caller handles across requests.

```ts
import { Application, apiKeyCaller } from "@narada/core";
import { createRuntime } from "@narada/runtime-aws";
import { createPublicApi } from "@narada/http-api";

const runtime = createRuntime(); // explicit environment configuration
const api = createPublicApi(runtime); // Hono fetch handler, no owner auth startup
const caller = apiKeyCaller(await runtime.service.authenticate(apiKey));
const result = await new Application(runtime).execute(
  caller,
  "contacts.create",
  { body: { email: "reader@example.com" } },
  { idempotencyKey: "customer-created-123" },
);
// result.value is the canonical Contact; metadata includes operationId/replayed.
```

Other services should normally use REST or the SDK. The application module is for
trusted in-process composition. Owner credentials, account security and approval
decisions remain owner-only. Existing dashboard routes retain legacy response
shapes and owner receipt handling; several still call domain services directly.
They are packaged separately from REST, not silently exposed through API keys.

Build with `pnpm backend:build`; verify archived packages in a temporary consumer
with `pnpm backend:check`. The latter checks default Node ESM resolution without
repository source imports, declarations, a real HTTP listener, worker entrypoints,
and the patched auth adapter. Workspace tooling uses the `development` export
condition for live source; packed exports always use `dist`, including when a
consumer enables development conditions. `pnpm check` builds the
backend before checking the dashboard. Do not publish these private packages as
part of this refactor.

The archive check installs dependencies in a temporary directory (registry access
may be required). It imports every packed public entrypoint and checks declarations
with `skipLibCheck=false`, with no diagnostic exceptions. `AuthService` is a
Narada-owned structural interface; the existing Better Auth instance is checked
against it at compilation. The provider still performs session and MCP token
verification, including its configured issuer, audience and DPoP checks.
Vendor configuration/adapter modules (`auth-base`, `oauth-auth`, `auth-database`)
are internal implementation files, not packed public exports. Workspace schema
provisioning/tests can still access them. This prevents Better Auth's Bun SQLite
and organization-plugin declaration errors from leaking into Node consumers
without changing or upgrading the authentication runtime.

`pnpm test:backend:browser` verifies API-key
provisioning/revocation, API documentation, integration guidance and public forms
against isolated local tables and ephemeral ports, without reusing the developer
dashboard. Local DynamoDB and SQS must be running.

The existing deployment remains CloudFront → API Gateway HTTP API → API Lambda
(`apps/api/src/lambda.ts`). That Lambda mounts the combined REST, owner, auth,
OAuth/MCP and recipient routes. Work, feedback and dispatch retain their Lambda
entrypoints and queue/stream integrations. The standalone Node servers below are
optional; this extraction does not replace the Lambda deployment. `pnpm infra:check`
asserts the API Gateway v2 Lambda integration and bundles the existing handlers.
`tests/integration/lambda-hosting.test.ts` invokes the API/worker adapters with local
fixtures, covering cookie sessions, OAuth/MCP routing, mutation replay, email
acceptance and SQS partial failures without cloud mutations.

After building, a configured Node host can run `pnpm --filter @narada/api start`
and `pnpm --filter @narada/worker start`. Supply the existing database, queue,
mail/provider and secret configuration; these commands do not provision it or
load `.env.local`. The API listens on `HOST` (default `127.0.0.1`) and `PORT`
(default `3001`). Use `HOST=0.0.0.0` behind the host's authenticated network/proxy
configuration when needed. The API includes only `/api/v1/*` and `/api/health`.
The health endpoint is liveness, not a database/queue readiness check. Mount the
owner, OAuth/MCP and recipient/public-content routers separately where required.
The worker process consumes work and feedback and runs dispatch; do not omit it
when hosting the API, and do not run a second incompatible job generation during
rollout. Shutdown drains in-flight work before releasing queue/database clients.

### Origins and migration identity

Optional configuration separates `API_ORIGIN`, `DASHBOARD_ORIGIN`, `PUBLIC_ORIGIN`
and `ASSET_ORIGIN`. They default to the existing `BETTER_AUTH_URL` (assets default
to the public origin), preserving current links. `BETTER_AUTH_URL` remains the
OAuth issuer/resource origin. This does not enable cross-origin browser cookies
or CORS; retain same-origin proxy routing for the dashboard and authentication
unless those flows are separately configured and verified. Public content and
media origins must route the corresponding recipient endpoints and assets.

`NARADA_INSTALLATION_ID` separates receipt/activity ownership from the host name.
It defaults to the historical `BETTER_AUTH_URL`. Before changing that auth origin,
pin this value to the **previous exact auth URL**, on every API and worker process,
to retain historical receipt/activity lookup. Do not generate a new identifier
for an existing installation. Changing API_ORIGIN alone does not change it.
Issuer changes still require an explicit OAuth grant/client migration; this
setting does not make old issuer tokens valid on a new issuer. Keep the existing
secret, table contents and previously sent public URLs valid through a cutover.

The OAuth DynamoDB adapter patch is required outside the monorepo too. Core's
build verifies the reviewed patched distribution checksum and includes that
adapter plus its license in `dist/auth-database.*`; it does not depend on a
consumer applying this workspace's pnpm patch. Review the checksum, patch and
OAuth rotation tests together when upgrading the adapter.

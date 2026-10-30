# Contributing to Narada

Narada is a TypeScript monorepo for email delivery, newsletters and forms, with local development tooling and AWS deployment code. Start with the [README](README.md), [architecture](docs/ARCHITECTURE.md), and [API contract](docs/API.md).

Narada and its SDK are licensed under [Apache 2.0](LICENSE). Unless explicitly stated otherwise, contributions intentionally submitted for inclusion are provided under that license. Preserve third-party license and attribution notices; see [licensing](docs/LICENSING.md).

## Local setup

Install Node.js 24, pnpm 11.9.0, and Docker with Compose. No AWS account or SES credentials are needed for development.

```sh
git clone https://github.com/Durga-Digital/narada.git
cd narada
pnpm install --frozen-lockfile
pnpm dev
```

Once running, open `http://localhost:5173`. The local owner credentials are printed by the development command and saved in `.local/owner.json`. Test messages are captured at `http://localhost:8025` in Mailpit.

Use `pnpm dev:doctor` if startup fails. `pnpm dev:down` stops containers while preserving local data. `pnpm dev:reset` is destructive and asks for confirmation; it is not a normal prerequisite for contributing.

## Where changes belong

| Area                                            | Directory         |
| ----------------------------------------------- | ----------------- |
| Dashboard and shared UI                         | `apps/web/`       |
| HTTP routes and authentication adapters         | `apps/api/`       |
| Queue consumers and local worker                | `apps/worker/`    |
| Validation, domain rules, persistence, delivery | `packages/core/`  |
| Public Node.js SDK                              | `packages/sdk/`   |
| AWS resources and deployment configuration      | `infrastructure/` |
| Local tooling and release scripts               | `scripts/`        |
| Unit, integration, browser tests                | `tests/`          |

Keep business rules in core services so local and AWS entrypoints behave consistently. Reuse shared UI primitives and existing feedback/confirmation components. Product behavior changes must keep the dashboard, API, SDK and MCP contracts, authorization, documentation and relevant tests consistent. Follow [AGENTS.md](AGENTS.md) and [contract CI](docs/CONTRACT-CI.md).

Delivery changes must preserve conditional worker claims, idempotency, suppression checks and the rule that uncertain sends are not automatically retried. Never reintroduce email bodies or authentication codes into delivery logs, API responses, toasts or test output. See [message retention](docs/MESSAGE-RETENTION.md).

## Validate a change

Run the checks relevant to the change. The following mirrors the main CI validation sequence and uses local services:

```sh
pnpm contracts:verify
pnpm check
pnpm sdk:check
pnpm infra:check
docker compose up -d
pnpm dev:seed
pnpm test:integration
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

`pnpm check` runs TypeScript checks, unit tests, and SDK/frontend builds. `pnpm infra:check` synthesizes and checks infrastructure locally; it does not deploy. Integration tests use separate `narada-integration-*` tables. Browser tests use the local owner and can leave test data in the development dashboard. Avoid running these suites concurrently against the same local database.

For targeted checks:

```sh
pnpm exec vitest run --project unit tests/unit/deployment.test.ts
pnpm exec vitest run --project integration tests/integration/message-retention.test.ts
pnpm exec playwright test tests/e2e
```

Format changed files with `pnpm exec prettier --write <files>` and check the diff with `git diff --check`. Avoid repository-wide formatting unrelated to the change. Use `pnpm format:check` to inspect repository formatting.

## Pull requests

Create a feature branch and keep each pull request focused. Explain the problem, the resulting behavior, how you tested it, and any migration or rollout requirements. Include screenshots for meaningful UI changes. Add regression tests for delivery, authentication, permissions, persistence and other behavior where a failure would matter.

Do not include `.env.local`, `.local/`, owner credentials, API keys, real email contents, database exports, or generated CDK output. Use synthetic addresses and tokens in fixtures. If a check fails, include the failure and relevant sanitized context rather than claiming it passed.

Pull requests run validation without AWS deployment credentials. Merging to `main` triggers staging deployment in the maintained installation. Production requires explicit manual workflow dispatch. See the [release runbook](README.md#deploy-production-manually); contributing code is not permission to deploy production or publish the SDK.

## Reporting problems

For ordinary bugs, provide reproduction steps, expected and actual behavior, the Git revision, local/AWS mode, and sanitized logs. Do not place credentials, authentication links, recipient data, or exploit details in a public issue. Follow [SECURITY.md](SECURITY.md) for private vulnerability reporting.

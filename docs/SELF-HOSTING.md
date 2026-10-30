# AWS operator deployment guide

This guide documents deployment of an independent single-workspace installation on AWS. A clean-account deployment and restore drill remain operator validation tasks. General VPS and non-AWS production hosting are not covered.

Deployment uses ignored local configuration. No account-specific source edits are needed.

For local evaluation, follow [Run locally](../README.md#run-locally). It requires no AWS account. For source changes, see [Contributing](../CONTRIBUTING.md).

## 1. Prepare your deployment

You need Node.js 24, pnpm 11.9.0, AWS CLI v2, and credentials authorized to create the CDK infrastructure. The installer deploys Lambda, API Gateway, DynamoDB, SQS, SNS, SES configuration, SSM parameters, S3 and CloudFront. These resources incur AWS charges. No AWS account creation is automated by the installer.

Copy the example and edit each stage in the ignored file:

```sh
cp narada.deploy.example.json narada.deploy.json
```

Replace every example value for the stage you plan to deploy:

- `account`: your 12-digit AWS account ID.
- `profile`: your AWS CLI profile.
- `region`: the region for the installation and SES sending.
- `ownerEmail`: the initial administrator's email address.
- `authFrom`: the sender for Narada's password-reset email.

Separate staging and production accounts are the existing release model. You can evaluate a staging installation before setting up production. `OWNER_EMAIL` and `AUTH_FROM` can override defaults; `--profile` and `--region` can override the selected profile/region. The AWS account remains pinned to the stage preset.

Deployment will refuse missing settings. `NARADA_ACCOUNT_ID`, `AWS_REGION`, `OWNER_EMAIL` and `AUTH_FROM` provide configuration for CI; local accounts are read from `narada.deploy.json`. `NARADA_DEPLOY_CONFIG` selects a different configuration file. `CDK_DEFAULT_ACCOUNT` never overrides the target account.

## 2. Preview and deploy staging

After configuring your AWS profile, use its name below in place of `my-narada-staging`:

```sh
pnpm install --frozen-lockfile
aws sso login --profile my-narada-staging
aws sts get-caller-identity --profile my-narada-staging
pnpm run deploy --stage staging --profile my-narada-staging --plan
pnpm run deploy --stage staging --profile my-narada-staging --bootstrap
```

Use **`pnpm run deploy`**, since `pnpm deploy` is a different built-in pnpm command. SSO login applies to SSO profiles; use your organization's credential setup for other profile types. Review the plan, including IAM changes, before applying. `--bootstrap` provisions the CDK toolkit on the first deployment. Subsequent deployments omit it.

The script verifies the selected AWS account, builds and validates the application, deploys infrastructure/assets, and initializes an owner without resetting an existing password. It saves outputs and generated owner credentials under ignored `.local/` files whose names include the account, region and stage. The terminal prints the credential file path rather than the password.

Sign in at the deployment's emitted HTTPS URL. Preserve the generated credentials and SSM auth secret securely. The default CloudFront URL is sufficient for an installation and SDK base URL; a custom domain is optional.

## 3. Complete SES setup

Deploying a `production` stage does not grant SES production access. In each sending account/region:

1. Add your sending domain in Narada and publish its DKIM records at the authoritative DNS provider.
2. Check verification and configure DMARC and optional custom MAIL FROM as described in the dashboard.
3. While SES is in its sandbox, verify the recipient inbox used for tests or use the SES mailbox simulator.
4. Request SES production access for real recipient sending. This is an account/region request, not a request for every new domain.
5. Open **Profile → Security**, choose a verified domain for recovery emails, and save it. Use **Send reset link** to check delivery to your owner inbox. Until a sender is saved, the deployment `authFrom` remains in use and must be verified. See [profile and account security](PROFILE-SECURITY.md), including SES sandbox requirements. You can change your password with your current password without setting up email first.

Follow [SES onboarding](SES-ONBOARDING.md) and [domain authentication](DOMAIN-AUTHENTICATION.md). Replace installation-specific profiles, addresses and domains in examples with your own.

## 4. Verify the installation

```sh
pnpm deploy:smoke --stage staging
```

Smoke checks use saved deployment outputs and the generated owner credentials. After changing the owner password, use `--public` for unauthenticated checks and verify login manually. Public checks do not prove email delivery.

Test sending, SES feedback, suppressions and webhook delivery with an inbox/endpoint you control. Configure billing budgets and alert destinations: the stack creates dead-letter alarms but does not subscribe an operator to them. Review [operations and recovery](ARCHITECTURE.md#retention-failures-and-recovery) before relying on the system.

Repeat the preview/deploy/verification steps with your production preset and credentials when ready. Retained tables and buckets can continue to incur charges after stack removal; do not use stack deletion as a routine reset.

## 5. Optional custom domain and CI/CD

Follow the [custom domain runbook](CUSTOM-DOMAIN.md) with your own hostname and certificate. The deployment supports `NARADA_CUSTOM_DOMAIN` and `NARADA_CERTIFICATE_ARN`.

Local CLI deployment works without GitHub Actions. Before enabling release workflows in a fork, configure all of the following:

| File/setting                           | Change for your installation                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `narada.deploy.json` (ignored)         | Local operator account, profile, region, owner and sender for each stage                                         |
| GitHub environment secrets             | `NARADA_ACCOUNT_ID`, `OWNER_EMAIL`, `AUTH_FROM` in each environment; set `AWS_REGION` as an environment variable |
| Repository variables                   | Set `NARADA_DEPLOY_ENABLED=true` after initial deployment and trust setup                                        |
| Delivery-role provisioning environment | `NARADA_GITHUB_REPOSITORY` and `NARADA_GITHUB_SUBJECT_PREFIX` for the exact repository OIDC subject              |
| GitHub environments                    | `staging` and `production`, main-only branch restrictions, optional hostname/certificate variables               |
| AWS delivery roles                     | Provision trust for your repository and environments; reuse an existing OIDC provider where applicable           |

See [GitHub Actions releases](../README.md#github-actions-releases) for role provisioning and manual production dispatch. Initial deployment and owner setup happen through the operator CLI before CI can update an installation. Forking the repo does not transfer the original repository's secrets, environment configuration or AWS trust.

The SDK publish workflow targets `@durgadigital/narada`; self-hosting does not require republishing it. The publish workflow requires `NARADA_SDK_PUBLISH_ENABLED=true`. Leave publishing disabled in a fork unless you intentionally maintain a differently named package with your own registry permissions.

## Custom publication subdomains

See [publication subdomains](PUBLICATION-DOMAINS.md) for the five shared management operations, dedicated domain-write consent, DNS/HTTPS setup, asynchronous recovery and default-address fallback. The local implementation includes dashboard, API, SDK and MCP coverage; deployment and SDK publication are separate release steps. DNS-provider writes remain an operator action.

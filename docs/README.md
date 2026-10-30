# Narada documentation

Start with the [project overview and local setup](../README.md) and [contributor guide](../CONTRIBUTING.md). The repository provides local development tooling and AWS deployment code for independent single-workspace installations.

## Current guides

| Topic                             | Guide                                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP API and Node SDK             | [API](API.md), [SDK usage](../packages/sdk/README.md)                                                                                                       |
| OAuth MCP and agent integration   | [MCP](MCP.md), [agent onboarding](AGENT-ONBOARDING.md)                                                                                                      |
| Shared operations and permissions | [product API](PRODUCT-API.md), [operational API](OPERATIONAL-API.md), [campaign API/MCP](CAMPAIGN-MCP.md)                                                   |
| Delivery, consent and recovery    | [broadcasts](BROADCASTS.md), [send approvals](SEND-APPROVALS.md), [activity](ACTIVITY.md), [idempotency](IDEMPOTENCY.md), [retention](MESSAGE-RETENTION.md) |
| Forms, templates and events       | [forms](FORMS.md), [templates](TEMPLATES.md), [webhooks](WEBHOOKS.md)                                                                                       |
| Account and sending setup         | [profile/security](PROFILE-SECURITY.md), [SES onboarding](SES-ONBOARDING.md), [domain authentication](DOMAIN-AUTHENTICATION.md)                             |
| AWS operations                    | [operator deployment](SELF-HOSTING.md), [dashboard hostname](CUSTOM-DOMAIN.md), [publication domains](PUBLICATION-DOMAINS.md)                               |
| Architecture and contributions    | [architecture](ARCHITECTURE.md), [operation contracts](OPERATION-CONTRACTS.md), [contract CI](CONTRACT-CI.md), [repository instructions](../AGENTS.md)      |
| Licensing and publication         | [licensing](LICENSING.md), [release readiness](OPEN-SOURCE-READINESS.md), [security reporting](../SECURITY.md)                                              |

## Plans and historical investigations

[Product requirements](PRD.md), [newsletter v1](NEWSLETTERS-V1.md), [branding v1](PUBLICATION-BRANDING-V1.md), [branding v2](PUBLICATION-BRANDING-V2.md), [publication domains v1](PUBLICATION-DOMAINS-V1.md), [publication site work](PUBLICATION-SITE-PLAN.md), [agent access](AGENT-ACCESS-PLAN.md) and [OAuth feasibility](OAUTH-FEASIBILITY.md) record design decisions and increment-specific acceptance criteria. They remain at stable paths so existing references keep working.

Dated validation and deployment statements apply only to the described revision or increment. A source implementation does not establish hosted availability or npm publication. Check the target server's capabilities/discovery and the installed SDK version before using a new operation. Keep installation-specific rollout logs, account identifiers and private integration plans outside public documentation.

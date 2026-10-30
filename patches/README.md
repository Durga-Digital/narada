# Dependency patches

`@datar-platform/better-auth-dynamodb@0.2.2` is patched through `pnpm-workspace.yaml`. Keep the patch when installing or updating dependencies until the equivalent fixes exist upstream.

The patch makes missing attributes match null predicates and preserves `incrementOne` predicates inside revision-guarded DynamoDB transactions. These are required for Better Auth OAuth refresh rotation. It changes the shared adapter, so upgrades must rerun both `pnpm test:oauth` and existing auth integration tests with fresh local fixtures.

See [OAuth feasibility](../docs/OAUTH-FEASIBILITY.md) for reproduction, scope, and remaining production gates. This patch has not been submitted upstream.

The extracted core package also embeds the reviewed patched adapter during `pnpm backend:build`, with a checksum check and third-party license. This preserves OAuth behavior for consumers outside this pnpm workspace. Update `packages/core/build-auth-adapter.mjs` only with a reviewed adapter change and passing OAuth concurrency tests.

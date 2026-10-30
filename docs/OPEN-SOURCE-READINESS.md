# Open-source release readiness

Updated 28 October 2026. This checklist tracks publishing readiness; it is not a security certification or a clean-AWS-account deployment certification.

## Prepared in source

- Root Apache 2.0 license and copyright NOTICE, matching the SDK license, notice and package metadata. Prior MIT distributions retain their original permissions; no package publication is implied.
- Contributor, AWS operator, security-reporting and custom-domain guides; issue and pull-request templates; a [documentation index](README.md) distinguishing current guides from historical plans.
- Ignored local deployment configuration with a public example. CI receives private account/owner/sender settings as GitHub environment secrets and region as a variable.
- Tests use example accounts, independent of operator configuration.
- Exact AWS account checks and OIDC repository/environment trust remain enforced.
- Deployment and npm publishing require explicit repository opt-in variables. Contributions run validation without deployment credentials.
- Pinned, checksum-verified Gitleaks scanning in CI, with redacted output.
- Public examples use synthetic domains, accounts and generic application names. Private deployment reports and consumer-specific integration scripts are excluded from the public source. The SDK package name and company copyright attribution remain intentional public project identity.
- Documentation describes the open-source application, local development and independent AWS installations. Commercial offering plans and internal cross-product roadmaps are excluded.

## Publication checklist

1. Validate the prepared source and the exact publication history. Pre-cleanup history contains personal commit metadata and operator-specific details removed from current files; a normal cleanup commit does not remove them. Publish only a reviewed clean snapshot or comprehensively sanitized history. Check redacted secret-scan results and inspect source and commit metadata for personal data. Automated scanning does not prove the absence of all sensitive information.
2. Preserve a private offline backup of the existing history and operational settings. Never push this backup into the public repository.
3. Freeze pushes while replacing history. Reconcile all remote branches and tags; a remaining old ref can retain the original history. Contributors must re-clone afterward rather than merge an old branch back.
4. Review pull-request refs, cached commits, Actions logs/artifacts, releases, issues and attachments before changing visibility. A force-push alone does not erase these surfaces. Follow [GitHub's removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository); support assistance has eligibility limits.
5. Configure environment secrets and variables before enabling releases. Keep deployment disabled during the history replacement. Verify that the same repository identity and environment trust remain in effect.
6. Enable private vulnerability reporting and appropriate branch/environment protections. Do not assume protections exist because workflow files mention them.
7. Complete the [third-party license and asset review](LICENSING.md#third-party-components), confirm contribution rights, and verify LICENSE/NOTICE contents in release artifacts. Review the exact publication candidate while the repository is still private, then explicitly approve changing visibility. Do not publish while personal data remains reachable through other refs or repository surfaces.

## Remaining operational validation

A first deployment in a clean AWS account and a restore drill are still operator tasks. Local/infrastructure tests and existing installations do not prove every new operator's AWS permissions or SES approval path. Configure alert destinations and billing budgets. Automatic SES quota pacing remains future product work.

Narada is a single-workspace installation. This release does not establish tenant isolation or readiness to host unrelated customers on shared infrastructure. A changelog, version/backport policy and code of conduct can be added as the maintenance policy develops.

## Cleanup validation scope

The 28 October cleanup changes documentation, example names, license metadata and SDK archive checks. Dashboard behavior, REST routes, canonical contracts, SDK methods and MCP permissions/recovery are unchanged. Owner-only exclusions remain in force. No deployment, npm publication or visibility change is implied by the source edit. Remote history replacement must use the separately verified publication candidate and preserve private backups.

The dependency inventory was completed from an isolated frozen-lockfile installation using a fresh pnpm store. See [the license review](LICENSING.md#dependency-and-asset-review--28-october-2026) and its recorded lockfile fingerprint. The frontend build emits dependency licenses and preserves the missing upstream attribution notice. GitHub-only surfaces (especially retained merged-PR refs and cached commits) remain a separate publication gate; replacing branches and tags cannot purge those records.

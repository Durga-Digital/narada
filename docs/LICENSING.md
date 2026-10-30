# Licensing

Narada's original project source and documentation are licensed under the [Apache License, Version 2.0](../LICENSE). Copyright attribution is retained in [NOTICE](../NOTICE). The [Node SDK](../packages/sdk/README.md) uses the same license and ships its own matching LICENSE and NOTICE files in the npm archive. Package manifests use the SPDX identifier `Apache-2.0`.

This change applies to the source in this checkout. It does not publish an npm package, change repository visibility or alter the permissions attached to previously distributed MIT versions. A subsequent SDK publication must use a new version and describe the license change in its release notes.

## Contributions and branding

Contributions intentionally submitted for inclusion are covered by Apache 2.0 unless explicitly stated otherwise, as described in the license. Contributors must have the right to contribute their changes. Preserve existing copyright, patent, attribution and license notices when incorporating third-party work.

The copyright holder remains Durga Digital. Apache 2.0 includes a contributor patent grant and does not grant rights to the Narada or Durga Digital trademarks, except the descriptive uses allowed by the license. No additional restriction on commercial use or independent hosting is added. The source license does not include a support commitment.

## Third-party components

Dependencies and bundled assets retain their own licenses; the root license does not relicense them. Preserve required notices in distributed artifacts, including browser bundles and vendored code. Review the exact locked versions and any copied source, fonts, icons and images before publishing a release.

The patched `@datar-platform/better-auth-dynamodb` adapter remains third-party code. [The core build](../packages/core/build-auth-adapter.mjs) copies its upstream license into `dist/THIRD-PARTY-LICENSES.txt` alongside the embedded adapter; retain that output. See the [patch notes](../patches/README.md). Do not replace upstream MIT, Apache, MPL or other notices with Narada's license.

Run `pnpm licenses list --prod --json` against a complete installation to inventory runtime dependency metadata, and inspect applicable upstream license files and distribution requirements. Package metadata alone is not a complete license audit. The SDK archive check (`pnpm sdk:check`) verifies that its LICENSE and NOTICE match the root files and survive packing and installation.

## Dependency and asset review — 28 October 2026

The [reviewed inventory](dependency-licenses.json) records 399 package entries from an isolated, frozen-lockfile installation with install scripts disabled. It includes build tooling declared as production dependencies and identifies the reviewed lockfile by SHA-256. Other operating systems can select different optional native binaries; review those when distributing them. No dependency in this inventory declares GPL, AGPL, SSPL or a proprietary-only license.

The declared licenses are MIT, MIT-0, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, MPL-2.0 and the dual-license choices MIT/CC0 and MPL/Apache. They do not change the license of Narada's original source. DOMPurify is available under Apache 2.0 or MPL 2.0; use its Apache option for this distribution. Lightning CSS and its native binaries use MPL 2.0 and are unmodified build tools, not browser-bundle modules. If redistributing those binaries, retain their notices and provide access to their corresponding MPL source. See [Mozilla's distribution guidance](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

The frontend build emits `third-party-licenses.txt` from the modules actually bundled, and each JavaScript chunk points to it and `third-party-notices.txt`. The latter preserves the upstream MIT copyright notice for `react-remove-scroll-bar`, whose npm archive omits its license file. Keep both files with frontend distributions. This build's inventory contains 144 bundled packages. The SDK has no runtime dependencies. The embedded DynamoDB adapter retains its upstream license through the core build described above.

The three checked-in image assets are the project's paper-plane favicon in SVG, PNG and ICO formats. No customer images, stock photography or font binaries are checked in; styles use font stacks rather than downloaded font files. Preserve the project's attribution and third-party notices when redistributing assets. This review covers the source and identified build artifacts, not a blanket relicensing of dependencies or a promise about future additions.

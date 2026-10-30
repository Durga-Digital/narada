# API, SDK and MCP contract checks

The `API, SDK and MCP contracts` job in `.github/workflows/ci.yml` runs for every
pull request and merge group, without path filters. The existing `validate` job
requires it to pass. The reusable release validation also includes this gate.
The SDK publish workflow checks generated files, types and parity tests before
building and publishing its tested archive. Adding these checks does not deploy
Narada or publish an SDK release.

Run the same contract gate locally:

```sh
pnpm contracts:verify
```

It checks:

- Generated JSON Schemas and SDK types match `packages/contracts/src`. CI uses
  `--check` and fails on drift instead of regenerating files to conceal it.
- Every catalog operation has a typed SDK invocation in
  `tests/contracts/sdk-bindings.ts` and an MCP tool, or a specific exclusion in
  `tests/contracts/transport-exclusions.ts`. Unknown, duplicate or missing
  operations and obsolete or unexplained exclusions fail.
- Every SDK binding accepts the canonical input and returns a compatible
  canonical output type. Tests call the real SDK with a fake HTTP transport and
  compare methods, encoded paths, distinct resource IDs, query parameters, JSON
  bodies, authorization, mutation retry keys and abort propagation. Minimal and
  complete structural fixtures exercise optional fields and union alternatives.
- MCP inputs preserve the canonical envelope, require mutation retry keys and
  reject caller-supplied authorization context. Advertised product tools must
  resolve to the shared executor. Exhaustive TypeScript switches prevent new
  operations in supported namespaces from silently lacking execution cases.
- The built SDK can be packed and consumed through its public package exports
  and declarations.

`pnpm test:contracts` runs the focused tests. `pnpm check` also includes those
unit tests and type checking. Full CI runs the OAuth and MCP integration suite,
including scope selection, resource restrictions, revocation and recovery.
Chromium is installed before those tests because OAuth consent uses a browser.

## Updating a contract

1. Change the canonical operation/types, shared executor, SDK and MCP as needed.
2. Add or update the explicit SDK binding. Update behavioral integration tests
   and user documentation for the affected operations.
3. Run `pnpm contracts:generate` and include the generated artifacts.
4. Run `pnpm contracts:verify` and the relevant integration tests. Run
   `pnpm test:mcp` when changing MCP execution, discovery or permissions.

Exclusions are deliberately narrow: OAuth identity has no SDK HTTP binding;
OpenAPI discovery has no SDK wrapper or MCP tool. Transactional email send/status now share the REST/MCP executor and require owner approval for sending. The checked manifest
records the reasons. Remove an exclusion when that transport gains support.
Do not use exclusions to bypass unfinished feature work.

These checks enforce catalog coverage and structural transport consistency.
They do not prove all business semantics or notice a UI-only feature that was
never added to the catalog. Repository instructions, review and integration
coverage remain necessary for authorization, consent and side effects.

## Required checks on GitHub

To block merges, the repository's branch ruleset or branch protection must
require `API, SDK and MCP contracts` and the existing `validate` check. Select the
checks from a completed pull-request run in GitHub. Keep them required for merge
queues too; this workflow handles `merge_group` events. Repository rules are
remote settings and are not changed by these files. Review bypass permissions
when configuring the rule.

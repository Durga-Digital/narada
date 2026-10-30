# Narada repository instructions

## Keep the API, SDK and MCP in sync

Narada is consumed through its dashboard, public API, Node SDK and OAuth MCP.
For every task, assess the impact on all four surfaces before making changes.
A product feature or behavior change is not complete until its applicable API,
SDK and MCP contracts, implementation, documentation and tests are up to date
in the same change. Do not leave machine-client support as an implicit follow-up.

- Define external inputs, outputs, operation IDs, HTTP bindings, permissions and
  effects in `packages/contracts/src`. Keep this the canonical source; do not
  introduce independent transport schemas or hand-edit generated artifacts.
- Implement shared operations and domain rules in `packages/core/src`.
  Public REST and MCP must use the same authorized execution boundary rather
  than duplicate business logic or call each other with privileged credentials.
- Update API routes, SDK methods/types in `packages/sdk`, and MCP discovery in
  `packages/contracts/src/mcp.ts` when adding, changing or removing an operation.
  Check tool descriptions, annotations, pagination and request/response schemas,
  not just whether a tool name exists.
- Preserve existing REST/SDK compatibility. Enforce scopes and resource
  restrictions on discovery, lists, direct access, linked resources and receipt
  replay. Do not silently expand legacy keys or OAuth grants.
- Preserve revision checks, consent rules, public DTO privacy, idempotency,
  activity/status tracking and recovery semantics across transports. A lost
  response must not cause duplicate sends or other repeated work.
- Update affected documentation and examples, including SDK usage and MCP
  permissions/recovery instructions. Keep local implementation status distinct
  from deployed or published availability.

Not every UI change needs a new tool. For presentation-only, internal or
documentation changes, verify that external behavior is unchanged and record
that SDK/MCP changes are unnecessary. Preserve documented owner-only exclusions
such as credentials and account security. Document an intentional exclusion
or existing coverage gap rather than silently exposing privileged operations
or claiming parity that is not implemented.

## Validation and completion

- After contract changes, run `pnpm contracts:generate`, then
  `pnpm contracts:check`. The generator updates JSON Schemas and SDK types.
- Add an explicitly typed SDK call to `tests/contracts/sdk-bindings.ts` for each
  new operation. CI requires catalog coverage on SDK and MCP; intentional gaps
  need a specific reason in `tests/contracts/transport-exclusions.ts`. Never
  add blanket exclusions or weaken coverage tests to make a change pass.
- Run `pnpm contracts:verify` to reproduce the contract CI gate, including
  generated artifacts, type checking, SDK wire/MCP coverage and package checks.
- For behavior changes affecting API/SDK/MCP, run `pnpm check` and relevant
  integration tests. Run `pnpm test:mcp` when changing MCP operations, discovery,
  scopes, authorization or recovery. Run `pnpm sdk:check` when changing SDK
  methods, public types or packaging.
- Cover successful results against canonical schemas, permission denials and
  resource restrictions, compatibility, and mutation replay/recovery as relevant.
  Use isolated local test fixtures; do not exercise production mutations as a
  substitute for local verification.
- Documentation-only edits do not require the application test suite. Check
  referenced paths, commands and formatting instead.
- In the completion report, briefly state API/SDK/MCP impact, checks performed,
  and any intentional exclusions or unresolved gaps. Report blocked checks
  honestly. Do not deploy or publish packages unless the user has requested it.

## Architecture references

Consult the relevant guide rather than copying its details into these instructions:

- [Contract CI enforcement](docs/CONTRACT-CI.md)
- [Shared contracts and authorization](docs/OPERATION-CONTRACTS.md)
- [Agent access plan and exclusions](docs/AGENT-ACCESS-PLAN.md)
- [MCP connection and transport](docs/MCP.md)
- [Activity and recovery](docs/ACTIVITY.md)
- [Human approval for sends](docs/SEND-APPROVALS.md)
- [SDK usage](packages/sdk/README.md)

## Code Review Rules

Flag product behavior changes that leave applicable API, SDK or MCP support
missing or inconsistent without a documented exclusion. Check authorization,
public schemas, compatibility and recovery across the affected transports;
passing generated-file checks alone does not establish feature parity.

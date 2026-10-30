import { Narada, NaradaError } from "../packages/sdk/src/index.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";

export const approvalScopes = [
  "openid",
  "offline_access",
  "narada:identity:read",
  "narada:capabilities:read",
  "narada:emails:send",
  "narada:emails:read",
  "narada:approvals:request",
  "narada:approvals:read",
  "narada:operations:read",
];
type Call = (tool: string, args?: any) => Promise<any>;
export function toolValue(result: any) {
  assert(!result.isError, JSON.stringify(result));
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}
function denied(result: any, status: number, code?: string) {
  assert(result.isError, "Expected denied operation");
  const error = JSON.parse(result.content[0].text);
  assert.equal(error.status, status);
  if (code) assert.equal(error.code, code);
}
/** Explicit opt-in smoke tests. All accepted mail goes to the SES simulator. */
export function hostedApprovals(options: {
  stage: string;
  allowProduction?: boolean;
  origin: string;
  name: string;
  domain: string;
  context: BrowserContext;
  report: any;
  pass: (message: string) => Promise<void>;
  json: (path: string, body?: any, method?: string) => Promise<any>;
  request: (path: string, body?: any, method?: string) => Promise<Response>;
}) {
  assert(
    options.stage === "staging" ||
      (options.stage === "production" && options.allowProduction),
    "Production simulator sends require explicit opt-in",
  );
  const { origin, name, domain, context, report, pass, json, request } =
    options;
  const keys: any[] = [],
    pending = new Set<string>();
  report.approvals = { cases: [], keys: [], messages: [] };
  const body = (label: string) => ({
    from: `Narada ${options.stage} <hello@${domain}>`,
    to: "success@simulator.amazonses.com",
    subject: `${name}: ${label}`,
    text: `${options.stage} approval verification. This message is intended only for the SES mailbox simulator.`,
    html: `<p>${options.stage} approval verification. SES mailbox simulator only.</p>`,
    priority: "high" as const,
    tags: { verification: name },
    expires_in: 3600,
  });
  async function prepare(call: Call, label: string) {
    const input = {
      body: { operation: "emails.send", input: { body: body(label) } },
      idempotencyKey: randomUUID(),
    };
    const approval = toolValue(await call("approvals_request", input));
    pending.add(approval.id);
    report.approvals.cases.push({ label, id: approval.id });
    return { input, approval };
  }
  async function exercise(call: Call, label: string, requiresApproval = true) {
    if (requiresApproval)
      denied(
        await call("emails_send", {
          body: body(label),
          idempotencyKey: randomUUID(),
        }),
        409,
        "approval_required",
      );
    else {
      const args = {
        body: body(`${label} automatic`),
        idempotencyKey: randomUUID(),
      };
      // Discard the initial response, then recover the same acceptance concurrently.
      const sent = toolValue(await call("emails_send", args));
      assert.equal(sent.replayed, false);
      report.approvals.messages.push(sent.id);
      for (const result of await Promise.all([
        call("emails_send", args),
        call("emails_send", args),
      ]))
        assert.deepEqual(toolValue(result), { id: sent.id, replayed: true });
      await pass(
        `${label}: automatic send and lost-response retries recover one message without owner approval`,
      );
    }
    const { input, approval } = await prepare(call, label);
    // Discard the creation result as a client would after a lost response, then retry its exact key.
    assert.equal(
      toolValue(await call("approvals_request", input)).id,
      approval.id,
    );
    assert.equal(
      toolValue(await call("approvals_get", { params: { id: approval.id } }))
        .status,
      "pending",
    );
    assert(!JSON.stringify(approval).includes(input.body.input.body.text));
    const review = await json(`/api/admin/approvals/${approval.id}`);
    assert.deepEqual(review.recipients, ["success@simulator.amazonses.com"]);
    assert.equal(review.from, input.body.input.body.from);
    assert.equal(review.text, input.body.input.body.text);
    assert.equal(review.priority, "high");
    const page = await context.newPage();
    let dropped = false;
    try {
      // The owner click commits on the server, but the browser loses its response.
      await page.route(
        `**/api/admin/approvals/${approval.id}/approve`,
        async (route) => {
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          dropped = true;
          await route.abort("failed");
        },
      );
      await page.goto(`${origin}/?page=approvals&approvalId=${approval.id}`);
      const region = page.getByRole("region", { name: "Send review" });
      await region
        .getByText(input.body.input.body.subject, { exact: true })
        .waitFor();
      await page
        .frameLocator('iframe[title="Approved message preview"]')
        .locator("body")
        .waitFor();
      await region
        .getByRole("button", { name: "Approve and send", exact: true })
        .click();
      await page
        .getByText(/Failed to fetch|fetch failed|Load failed|NetworkError/i)
        .waitFor({ timeout: 30000 });
      assert(dropped, "Owner response must actually be lost after acceptance");
    } finally {
      await page.close();
    }
    const result = toolValue(
      await call("approvals_get", { params: { id: approval.id } }),
    );
    assert.equal(result.status, "succeeded");
    assert(result.messageId && result.operationId);
    report.approvals.messages.push(result.messageId);
    pending.delete(approval.id);
    const repeated = await Promise.all(
      [0, 1].map(() =>
        json(`/api/admin/approvals/${approval.id}/approve`, {
          digest: review.digest,
        }),
      ),
    );
    for (const value of repeated) assert.deepEqual(value, result);
    assert.equal(
      toolValue(await call("approvals_request", input)).id,
      approval.id,
    );
    assert.equal(
      toolValue(await call("emails_get", { params: { id: result.messageId } }))
        .id,
      result.messageId,
    );
    const operation = await json(`/api/admin/operations/${result.operationId}`);
    assert(operation);
    await pass(
      `${label}: ${requiresApproval ? "mandatory" : "optional"} owner browser approval; lost request/decision responses and concurrent retries recover one message`,
    );
    return (await prepare(call, `${label} revoke before decision`)).approval
      .id as string;
  }
  async function assertRevoked(
    id: string,
    label: string,
    expectedStatus = 403,
  ) {
    const review = await json(`/api/admin/approvals/${id}`);
    const rejected = await request(`/api/admin/approvals/${id}/approve`, {
      digest: review.digest,
    });
    assert.equal(
      rejected.status,
      expectedStatus,
      `${label}: revoked authority must not send`,
    );
    const status = await json(`/api/admin/approvals/${id}`);
    assert.equal(status.status, "pending");
    assert(!status.messageId);
    await pass(`${label}: pending approval cannot execute after revocation`);
  }
  async function apiKeys() {
    for (const settings of [
      { permission: "sending" },
      { permission: "full" },
      { permission: "scoped", scopes: ["emails:send"] },
      { permission: "sending", domain },
      {
        permission: "operations",
        operationAccess: {
          scopes: approvalScopes.filter((s) => s.startsWith("narada:")),
          resources: { senderDomains: [domain] },
        },
      },
    ]) {
      const label = `API key ${settings.permission}${"domain" in settings ? " domain" : ""}`;
      const key = await json("/api/admin/keys", {
        name: `${name} ${label}`,
        ...settings,
      });
      keys.push(key);
      report.approvals.keys.push({ id: key.id, name: key.name });
      async function api(path: string, payload?: any, retryKey?: string) {
        const response = await fetch(origin + path, {
          method: payload === undefined ? "GET" : "POST",
          headers: {
            authorization: `Bearer ${key.token}`,
            origin,
            "content-type": "application/json",
            ...(retryKey ? { "idempotency-key": retryKey } : {}),
          },
          body: payload === undefined ? undefined : JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        });
        const value = await response.json();
        return response.ok
          ? { structuredContent: value }
          : {
              isError: true,
              content: [
                { text: JSON.stringify({ ...value, status: response.status }) },
              ],
            };
      }
      const call: Call = (tool, args) => {
        if (tool === "emails_send")
          return api("/api/v1/emails", args.body, args.idempotencyKey);
        if (tool === "emails_get")
          return api(`/api/v1/emails/${args.params.id}`);
        if (tool === "approvals_request")
          return api("/api/v1/approvals", args.body, args.idempotencyKey);
        if (tool === "approvals_get")
          return api(`/api/v1/approvals/${args.params.id}`);
        throw Error("Unexpected API test operation");
      };
      const id = await exercise(call, label, false);
      const review = await json(`/api/admin/approvals/${id}`);
      denied(
        await api(`/api/admin/approvals/${id}/approve`, {
          digest: review.digest,
        }),
        401,
      );
      if ("domain" in settings || settings.permission === "operations")
        denied(
          await call("approvals_request", {
            body: {
              operation: "emails.send",
              input: {
                body: { ...body(label), from: "outside@example.invalid" },
              },
            },
            idempotencyKey: randomUUID(),
          }),
          403,
        );
      await json(`/api/admin/keys/${key.id}/revoke`, {
        confirmation: key.name,
      });
      denied(await call("approvals_get", { params: { id } }), 401);
      denied(
        await call("emails_send", {
          body: body(label),
          idempotencyKey: randomUUID(),
        }),
        401,
      );
      await assertRevoked(id, label, 401);
    }
  }
  async function sdk() {
    const key = await json("/api/admin/keys", {
      name: `${name} SDK automatic`,
      permission: "sending",
      domain,
    });
    keys.push(key);
    report.approvals.keys.push({ id: key.id, name: key.name });
    const client = new Narada({ apiKey: key.token, baseUrl: origin });
    const input = body("SDK automatic");
    const options = { idempotencyKey: randomUUID() };
    const accepted = await client.send(input, options);
    assert.equal(accepted.replayed, false);
    report.approvals.messages.push(accepted.id);
    for (const replay of await Promise.all([
      client.send(input, options),
      client.emails.send(input, options),
    ]))
      assert.deepEqual(replay, { id: accepted.id, replayed: true });
    await json(`/api/admin/keys/${key.id}/revoke`, { confirmation: key.name });
    await assert.rejects(
      () => client.send(input, options),
      (error: unknown) => error instanceof NaradaError && error.status === 401,
    );
    await pass(
      "SDK send/emails.send: automatic acceptance, concurrent lost-response recovery and revoked-key denial",
    );
  }
  async function audit(table: string, profile: string, region: string) {
    const client = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region, credentials: fromIni({ profile }) }),
    );
    try {
      // Consistent base-table reads count only this run's tagged messages, including any accidental duplicates.
      const deadline = Date.now() + 120000;
      let rows: any[] = [];
      do {
        rows = [];
        let cursor: Record<string, any> | undefined;
        let pages = 0;
        do {
          assert(++pages <= 50, "Hosted audit scan exceeded bound");
          const data = await client.send(
            new ScanCommand({
              TableName: table,
              ConsistentRead: true,
              ExclusiveStartKey: cursor,
              FilterExpression:
                "begins_with(pk, :message) AND #input.#tags.#verification = :run",
              ProjectionExpression: "id, #status, attempts, providerId, events",
              ExpressionAttributeNames: {
                "#input": "input",
                "#tags": "tags",
                "#verification": "verification",
                "#status": "status",
              },
              ExpressionAttributeValues: { ":message": "MSG#", ":run": name },
            }),
          );
          rows.push(...(data.Items ?? []));
          cursor = data.LastEvaluatedKey;
        } while (cursor);
        assert.deepEqual(
          rows.map((r) => r.id).sort(),
          [...report.approvals.messages].sort(),
          "Every accepted API or approved MCP action must have exactly one message and revoked actions none",
        );
        if (rows.every((r) => r.status === "delivered")) break;
        assert(
          !rows.some((r) =>
            ["failed", "unknown", "expired", "bounced", "complained"].includes(
              r.status,
            ),
          ),
          "Simulator delivery failed or became uncertain",
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } while (Date.now() < deadline);
      assert(
        rows.every((r) => r.status === "delivered"),
        "Expected SES simulator delivery feedback",
      );
      for (const row of rows) {
        assert.equal(row.attempts, 1);
        assert(row.providerId);
      }
      assert.equal(new Set(rows.map((r) => r.providerId)).size, rows.length);
      report.approvals.audit = rows.map(
        ({ id, status, attempts, providerId }) => ({
          id,
          status,
          attempts,
          providerId,
        }),
      );
      await pass(
        "Consistent DynamoDB audit: exactly one message and one SES submission per accepted API or approved action, none for revoked approvals; all simulator messages delivered",
      );
    } finally {
      client.destroy();
    }
  }
  async function cleanup() {
    for (const id of pending) {
      try {
        const review = await json(`/api/admin/approvals/${id}`);
        if (review.status === "pending")
          await json(`/api/admin/approvals/${id}/reject`, {
            digest: review.digest,
          });
        report.cleanup.push({ approvalId: id, rejected: true });
      } catch {
        report.cleanup.push({ approvalId: id, rejected: false });
      }
    }
    for (const key of keys) {
      try {
        await json(`/api/admin/keys/${key.id}/revoke`, {
          confirmation: key.name,
        });
        report.cleanup.push({ keyId: key.id, revoked: true });
      } catch {
        report.cleanup.push({ keyId: key.id, revoked: false });
      }
    }
  }
  return { exercise, assertRevoked, apiKeys, sdk, audit, cleanup };
}

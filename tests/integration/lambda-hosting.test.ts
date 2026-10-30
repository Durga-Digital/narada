import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { SQSEvent } from "aws-lambda";
import type { Runtime } from "@narada/core/runtime";
import { initialize } from "../../scripts/local.js";
import { handler } from "../../apps/api/src/lambda.js";
import { handler as worker } from "../../apps/worker/src/lambda.js";

// Replace only AWS secret/bootstrap loading. Invoke the actual Lambda adapters,
// composed application, authentication and domain services against local tables.
const fixture = vi.hoisted(() => ({
  runtime: undefined as Runtime | undefined,
}));
vi.mock("@narada/runtime-aws/aws-runtime", () => ({
  awsRuntime: async () => {
    if (!fixture.runtime) throw new Error("Lambda fixture is not initialized");
    return fixture.runtime;
  },
}));
const prefix = process.env.NARADA_TEST_PREFIX!;
let runtime: Runtime, token: string, owner: { email: string; password: string };
beforeAll(async () => {
  vi.stubEnv("APP_TABLE", `${prefix}-app`);
  vi.stubEnv("AUTH_TABLE", `${prefix}-auth`);
  vi.stubEnv("WORKER_KIND", "work");
  runtime = fixture.runtime = await initialize(`.local/${prefix}-owner.json`);
  owner = JSON.parse(await readFile(`.local/${prefix}-owner.json`, "utf8"));
  token = (await runtime.service.createKey("Lambda compatibility", "full"))
    .token;
});
afterAll(() => {
  vi.unstubAllEnvs();
  runtime?.store.client.destroy();
  runtime?.queues.client.destroy();
});
const invoke = (
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    cookies?: string[];
    base64?: boolean;
  } = {},
) => {
  const origin = new URL(runtime.config.BETTER_AUTH_URL);
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  const event: Parameters<typeof handler>[0] = {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: {
      host: origin.host,
      "x-forwarded-proto": origin.protocol.slice(0, -1),
      "content-type": "application/json",
      ...options.headers,
    },
    cookies: options.cookies,
    body: body && options.base64 ? Buffer.from(body).toString("base64") : body,
    isBase64Encoded: options.base64 ?? false,
    requestContext: {
      authentication: null,
      authorizer: {},
      accountId: "local",
      apiId: "local",
      domainName: origin.host,
      domainPrefix: "local",
      http: {
        method: body === null ? "GET" : "POST",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "lambda-regression",
      },
      requestId: randomUUID(),
      routeKey: "$default",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
  };
  return handler(event, {
    awsRequestId: randomUUID(),
    callbackWaitsForEmptyEventLoop: false,
    functionName: "Narada-Api",
    functionVersion: "$LATEST",
    invokedFunctionArn: "local",
    memoryLimitInMB: "1024",
    logGroupName: "local",
    logStreamName: "local",
    getRemainingTimeInMillis: () => 25000,
  });
};
it("serves authenticated REST and replays mutations through API Gateway events", async () => {
  expect((await invoke("/api/health")).statusCode).toBe(200);
  expect((await invoke("/api/v1/contacts")).statusCode).toBe(401);
  const body = { email: `${randomUUID()}@example.com` };
  const headers = {
    authorization: `Bearer ${token}`,
    "idempotency-key": randomUUID(),
  };
  const first = await invoke("/api/v1/contacts", {
    body,
    headers,
    base64: true,
  });
  expect(first.statusCode).toBe(201);
  expect(JSON.parse(first.body).email).toBe(body.email);
  expect(first.headers?.["x-request-id"]).toBeTruthy();
  const replay = await invoke("/api/v1/contacts", { body, headers });
  expect(replay.statusCode).toBe(201);
  expect(replay.body).toBe(first.body);
  expect(replay.headers?.["idempotency-replayed"]).toBe("true");
});
it("retains owner sessions, OAuth discovery and MCP in the API Lambda", async () => {
  const login = await invoke("/api/auth/sign-in/email", {
    body: owner,
    headers: { origin: runtime.config.BETTER_AUTH_URL },
  });
  expect(login.statusCode).toBe(200);
  const cookies = login.cookies?.map((value) => value.split(";")[0]!);
  expect(cookies?.length).toBeGreaterThan(0);
  const session = await invoke("/api/auth/get-session", { cookies });
  expect(JSON.parse(session.body).user.email).toBe(owner.email);
  expect((await invoke("/api/admin/settings", { cookies })).statusCode).toBe(
    200,
  );
  expect(
    (await invoke("/.well-known/oauth-authorization-server/api/auth"))
      .statusCode,
  ).toBe(200);
  const mcp = await invoke("/api/mcp", {
    body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(mcp.statusCode).toBe(401);
  expect(mcp.headers?.["www-authenticate"]).toContain(
    "oauth-protected-resource",
  );
});
it("keeps email acceptance and SQS partial failures/retry behavior in Lambda", async () => {
  const response = await invoke("/api/v1/emails", {
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": randomUUID(),
    },
    body: {
      from: "hello@narada.test",
      to: "reader@example.com",
      subject: "Lambda fixture",
      text: "Local test",
    },
  });
  expect(response.statusCode).toBe(202);
  expect(response.headers?.["server-timing"]).toContain("setup;dur=");
  const id = JSON.parse(response.body).id;
  const send = vi
    .spyOn(runtime.transport, "send")
    .mockResolvedValue({ id: "lambda-test", captured: true });
  const record = (
    messageId: string,
    body: string,
  ): SQSEvent["Records"][number] => ({
    messageId,
    body,
    receiptHandle: "local",
    attributes: {
      ApproximateReceiveCount: "1",
      SentTimestamp: "0",
      SenderId: "local",
      ApproximateFirstReceiveTimestamp: "0",
    },
    messageAttributes: {},
    md5OfBody: "local",
    eventSource: "aws:sqs",
    eventSourceARN: "local",
    awsRegion: "us-east-1",
  });
  const valid = record("valid", JSON.stringify({ kind: "send", id }));
  try {
    expect(
      await worker({ Records: [valid, record("invalid", "invalid-json")] }),
    ).toEqual({ batchItemFailures: [{ itemIdentifier: "invalid" }] });
    expect(await worker({ Records: [valid] })).toEqual({
      batchItemFailures: [],
    });
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    send.mockRestore();
  }
});

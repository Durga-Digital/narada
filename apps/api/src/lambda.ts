import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";
import { awsRuntime } from "@narada/runtime-aws/aws-runtime";
let cachedHandler: ReturnType<typeof handle> | undefined;
let firstInvocation = true;
export const handler = async (
  ...args: Parameters<ReturnType<typeof handle>>
) => {
  const started = performance.now(),
    cold = firstInvocation;
  firstInvocation = false;
  cachedHandler ??= handle(createApp(await awsRuntime()));
  const setupMs = performance.now() - started;
  const response = await cachedHandler(...args);
  const event = args[0];
  if (
    "rawPath" in event &&
    event.rawPath === "/api/v1/emails" &&
    event.requestContext.http.method === "POST"
  ) {
    response.headers = {
      ...response.headers,
      "server-timing": `setup;dur=${setupMs.toFixed(2)}, handler;dur=${(performance.now() - started).toFixed(2)}, cold;desc="${cold}"`,
    };
    console.info(
      JSON.stringify({
        event: "email_submission_response",
        awsRequestId: args[1]?.awsRequestId,
        cold,
        status: response.statusCode,
        setupMs: Math.round(setupMs * 100) / 100,
        handlerMs: Math.round((performance.now() - started) * 100) / 100,
      }),
    );
  }
  return response;
};

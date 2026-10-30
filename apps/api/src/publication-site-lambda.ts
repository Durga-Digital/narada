import { handle } from "hono/aws-lambda";
import { awsRuntime } from "@narada/runtime-aws/aws-runtime";
import { createPublicationSite } from "./publication-site.js";
let cached: ReturnType<typeof handle> | undefined;
export const handler = async (
  ...args: Parameters<ReturnType<typeof handle>>
) => {
  cached ??= handle(createPublicationSite(await awsRuntime()));
  return cached(...args);
};

import { awsRuntime } from "@narada/runtime-aws/aws-runtime";
import { createAuth } from "@narada/core/auth";
import { z } from "zod";
// Invoked using IAM from the deployment CLI. Never attached to an HTTP route.
export async function handler(event: unknown) {
  const { email, password } = z
    .object({ email: z.email(), password: z.string().min(16) })
    .parse(event);
  const r = await awsRuntime();
  if (email.toLowerCase() !== r.config.OWNER_EMAIL.toLowerCase())
    throw new Error("Bootstrap email must match the configured owner");
  const auth = createAuth(r.config, r.store, true);
  const ctx = await auth.$context;
  if (await ctx.internalAdapter.findUserByEmail(email))
    return { created: false };
  await auth.api.signUpEmail({
    body: { email, password, name: "Narada Owner" },
  });
  return { created: true };
}

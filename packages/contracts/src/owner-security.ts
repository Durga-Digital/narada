import { z } from "zod";

// Account security is deliberately outside the delegated operation catalog.
// These bindings require an owner session, never an API key or OAuth grant.
export const recoverySenderUpdate = z
  .object({
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .regex(
        /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/,
      ),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const recoverySenderSchema = z
  .object({
    domain: z.string().nullable(),
    from: z.string(),
    source: z.enum(["profile", "deployment"]),
    available: z.boolean(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type RecoverySender = z.infer<typeof recoverySenderSchema>;

export const ownerSecurityOperations = [
  {
    id: "owner.recovery-sender.get",
    http: {
      method: "GET",
      path: "/api/admin/profile/recovery-sender",
      status: 200,
    },
    permission: "owner-session",
    effect: "read",
    input: z.object({}).strict(),
    output: recoverySenderSchema,
    idempotency: "none",
  },
  {
    id: "owner.recovery-sender.update",
    http: {
      method: "PUT",
      path: "/api/admin/profile/recovery-sender",
      status: 200,
    },
    permission: "owner-session-and-origin",
    effect: "write",
    input: recoverySenderUpdate,
    output: recoverySenderSchema,
    idempotency: "optional-key",
  },
] as const;

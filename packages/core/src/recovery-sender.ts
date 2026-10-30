import {
  recoverySenderUpdate,
  recoverySenderSchema,
  type RecoverySender,
} from "@narada/contracts/owner-security";
import { AppError, type Domain, type Entity } from "./model.js";
import { conditional, type Store } from "./store.js";
import { commitMutation, type MutationCommit } from "./idempotency.js";

const key = "OWNER_RECOVERY_SENDER";
interface SavedSender extends Entity {
  domain: string;
  registrationId?: string;
  revision: number;
}
const sender = (domain: string) => `Narada <security@${domain}>`;
const usable = (domain: Domain | undefined, saved: SavedSender) =>
  !!domain &&
  !domain.removedAt &&
  domain.verified &&
  domain.registrationId === saved.registrationId;

export async function getRecoverySender(store: Store): Promise<RecoverySender> {
  const saved = await store.get<SavedSender>(key);
  // Preserve installations whose AUTH_FROM is an SES identity configured outside Narada.
  if (!saved)
    return {
      domain: null,
      from: store.config.AUTH_FROM,
      source: "deployment",
      available: true,
      revision: 0,
    };
  const domain = await store.get<Domain>(`DOMAIN#${saved.domain}`);
  return {
    domain: saved.domain,
    from: sender(saved.domain),
    source: "profile",
    available: usable(domain, saved),
    revision: saved.revision,
  };
}

export async function resolveRecoverySender(store: Store): Promise<string> {
  const settings = await getRecoverySender(store);
  if (!settings.available)
    throw new AppError(
      409,
      "Recovery sender is unavailable. Choose a verified domain in Profile → Security.",
    );
  return settings.from;
}

export async function authorizeRecoverySenderReplay(
  store: Store,
  raw: unknown,
) {
  const receipt = recoverySenderSchema.parse(raw);
  const current = await getRecoverySender(store);
  if (
    !current.available ||
    current.revision !== receipt.revision ||
    current.domain !== receipt.domain
  )
    throw new AppError(
      409,
      "Recovery settings or domain verification changed. Refresh the page before continuing.",
    );
}

export async function saveRecoverySender(
  store: Store,
  raw: unknown,
  commit?: MutationCommit,
): Promise<RecoverySender> {
  const input = recoverySenderUpdate.parse(raw);
  const [previous, domain] = await Promise.all([
    store.get<SavedSender>(key),
    store.get<Domain>(`DOMAIN#${input.domain}`),
  ]);
  if (!domain || domain.removedAt || !domain.verified)
    throw new AppError(
      400,
      "Choose a verified domain from Domains before saving a recovery sender.",
    );
  if ((previous?.revision ?? 0) !== input.revision)
    throw new AppError(
      409,
      "Recovery settings changed. Refresh the page before saving again.",
    );
  const saved: SavedSender = {
    pk: key,
    sk: "META",
    domain: input.domain,
    registrationId: domain.registrationId,
    revision: input.revision + 1,
  };
  const result: RecoverySender = {
    domain: input.domain,
    from: sender(input.domain),
    source: "profile",
    available: true,
    revision: saved.revision,
  };
  try {
    return await commitMutation(
      store,
      [
        {
          ConditionCheck: {
            TableName: store.config.APP_TABLE,
            Key: { pk: domain.pk, sk: "META" },
            ConditionExpression:
              "verified = :yes AND attribute_not_exists(removedAt) AND " +
              (domain.registrationId
                ? "registrationId = :registration"
                : "attribute_not_exists(registrationId)"),
            ExpressionAttributeValues: {
              ":yes": true,
              ...(domain.registrationId
                ? { ":registration": domain.registrationId }
                : {}),
            },
          },
        },
        {
          Put: {
            TableName: store.config.APP_TABLE,
            Item: saved,
            ConditionExpression: previous
              ? "revision = :revision"
              : "attribute_not_exists(pk)",
            ...(previous
              ? { ExpressionAttributeValues: { ":revision": input.revision } }
              : {}),
          },
        },
      ],
      result,
      commit,
    );
  } catch (error) {
    if (conditional(error))
      throw new AppError(
        409,
        "Recovery settings or domain verification changed. Refresh the page before saving again.",
      );
    throw error;
  }
}

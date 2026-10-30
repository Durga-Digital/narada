import { describe, expect, it, vi } from "vitest";
import { SubscriptionService } from "@narada/core/subscriptions";
import {
  marketingKey,
  segmentConsentKey,
  topicPreferenceKey,
} from "@narada/core/audience-model";
import {
  unsubscribeKey,
  unsubscribeToken,
} from "@narada/core/subscription-links";
import type { Store } from "@narada/core/store";
import type { Entity } from "@narada/core/model";

function fixture() {
  const rows = new Map<string, Entity>();
  const store = {
    get: vi.fn(async (pk: string) => rows.get(pk)),
    getMany: vi.fn(async (keys: string[]) =>
      keys.flatMap((pk) => (rows.has(pk) ? [rows.get(pk)!] : [])),
    ),
  };
  const add = (pk: string, data: Record<string, unknown> = {}) =>
    rows.set(pk, { pk, sk: "META", ...data });
  const service = new SubscriptionService(store as unknown as Store);
  const email = "reader@example.com",
    audienceId = "audience",
    topicId = "topic";
  add(segmentConsentKey(audienceId, email), { subscribed: true });
  add(`TOPIC#${topicId}`, { active: true, visibility: "public" });
  add(topicPreferenceKey(topicId, email), { subscribed: true });
  return { rows, store, add, service, email, audienceId, topicId };
}

describe("shared recipient policy", () => {
  it.each(["global", "legacy", "topic", "missing consent", "suppression"])(
    "preview and delivery agree on %s exclusions",
    async (reason) => {
      const f = fixture(),
        audience = { audienceId: f.audienceId, topicId: f.topicId };
      const contacts = [{ email: f.email, name: "Reader" }];
      expect(await f.service.eligible(audience, contacts)).toEqual(contacts);
      expect(await f.service.deliveryBlock(f.email, audience)).toBeUndefined();
      if (reason === "global") f.add(marketingKey(f.email));
      if (reason === "legacy") f.add(unsubscribeKey(f.audienceId, f.email));
      if (reason === "topic")
        f.add(topicPreferenceKey(f.topicId, f.email), { subscribed: false });
      if (reason === "missing consent")
        f.rows.delete(topicPreferenceKey(f.topicId, f.email));
      if (reason === "suppression") f.add(`SUPPRESS#${f.email}`);
      expect(await f.service.eligible(audience, contacts)).toEqual([]);
      expect(await f.service.deliveryBlock(f.email, audience)).toBe(
        reason === "suppression" ? "suppressed" : "unsubscribed",
      );
    },
  );
  it("rejects archived topics at launch and blocks archived or removed topics at delivery", async () => {
    const f = fixture(),
      audience = { audienceId: f.audienceId, topicId: f.topicId };
    f.add(`TOPIC#${f.topicId}`, { active: false });
    await expect(
      f.service.eligible(audience, [{ email: f.email }]),
    ).rejects.toThrow("archived");
    expect(await f.service.deliveryBlock(f.email, audience)).toBe(
      "unsubscribed",
    );
    f.rows.delete(`TOPIC#${f.topicId}`);
    expect(await f.service.deliveryBlock(f.email, audience)).toBe(
      "unsubscribed",
    );
  });
  it("keeps legacy audience consent independent of topic consent", async () => {
    const f = fixture();
    f.rows.delete(topicPreferenceKey(f.topicId, f.email));
    expect(
      await f.service.eligible({ audienceId: f.audienceId }, [
        { email: f.email },
      ]),
    ).toHaveLength(1);
  });
  it("does not treat membership as list consent", async () => {
    const f = fixture();
    f.rows.delete(segmentConsentKey(f.audienceId, f.email));
    expect(
      await f.service.eligible({ audienceId: f.audienceId }, [
        { email: f.email },
      ]),
    ).toEqual([]);
    expect(
      await f.service.deliveryBlock(f.email, { audienceId: f.audienceId }),
    ).toBe("unsubscribed");
  });
  it("never substitutes suppression for an explicit unsubscribe", async () => {
    const f = fixture();
    f.add(marketingKey(f.email));
    f.add(`SUPPRESS#${f.email}`);
    expect(
      await f.service.deliveryBlock(f.email, { audienceId: f.audienceId }),
    ).toBe("unsubscribed");
  });
  it("keeps directory subscription status distinct from delivery suppression and topic consent", async () => {
    const f = fixture();
    const audiences = [{ id: f.audienceId, contacts: [{ email: f.email }] }];
    f.add(`SUPPRESS#${f.email}`);
    f.add(topicPreferenceKey(f.topicId, f.email), { subscribed: false });
    expect(
      (await f.service.membershipStatus(audiences))
        .get(f.audienceId)
        ?.has(f.email),
    ).toBe(true);
    f.add(marketingKey(f.email));
    expect(
      (await f.service.membershipStatus(audiences))
        .get(f.audienceId)
        ?.has(f.email),
    ).toBe(false);
  });
});

it("old signed links still produce the same legacy opt-out records", async () => {
  const put = vi.fn(),
    service = new SubscriptionService({ put } as unknown as Store);
  const id = "6d531cb5-847e-4dca-9040-87002f839c86",
    email = "reader@example.com";
  const token =
    "eyJhdWRpZW5jZUlkIjoiNmQ1MzFjYjUtODQ3ZS00ZGNhLTkwNDAtODcwMDJmODM5Yzg2IiwiZW1haWwiOiJyZWFkZXJAZXhhbXBsZS5jb20ifQ.jzrsU3cZ0JiKEpbBzSIepObaHgTn5Pv-Faza7MXsNvo";
  expect(unsubscribeToken("secret", id, email)).toBe(token);
  await service.unsubscribe(token, "secret");
  expect(put).toHaveBeenCalledWith(
    expect.objectContaining({
      pk: unsubscribeKey(id, email),
      sk: "META",
      audienceId: id,
      email,
    }),
  );
  await expect(service.unsubscribe(token, "wrong-secret")).rejects.toThrow(
    "Invalid unsubscribe link",
  );
  expect(put).toHaveBeenCalledTimes(1);
});

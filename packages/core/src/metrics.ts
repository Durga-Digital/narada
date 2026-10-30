import {
  domainOf,
  type Entity,
  type Message,
  type DeliveryEvent,
} from "./model.js";
import type { Store } from "./store.js";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

export const metricKeys = [
  "accepted",
  "submitted",
  "captured",
  "delivered",
  "delayed",
  "bounced",
  "complained",
  "failed",
] as const;
export type MetricKey = (typeof metricKeys)[number];
export type Counts = Record<MetricKey, number>;
export const emptyCounts = (): Counts =>
  Object.fromEntries(metricKeys.map((k) => [k, 0])) as Counts;
export type MetricRow = Entity & {
  domain: string;
  day: string;
  updatedAt: string;
} & Partial<Counts>;
export interface MetricsSnapshot {
  mode: "local" | "aws";
  fetchedAt: string;
  startedAt: string | null;
  days: { day: string; counts: Counts }[];
  totals: Counts;
  domains: { domain: string; counts: Counts }[];
  cloudWatchUrl: string;
}
export function metricWrite(
  store: Store,
  msg: Message,
  increments: Partial<Counts>,
): NonNullable<TransactWriteCommandInput["TransactItems"]> {
  const entries = Object.entries(increments).filter(([, n]) => n! > 0);
  if (!entries.length || msg.metricsVersion !== 1) return [];
  const day = msg.createdAt.slice(0, 10),
    domain = domainOf(msg.input.from);
  return [
    {
      Update: {
        TableName: store.config.APP_TABLE,
        Key: { pk: `METRICS#${day}`, sk: `DOMAIN#${domain}` },
        UpdateExpression:
          "SET #domain = :domain, #day = :day, updatedAt = :now ADD " +
          entries.map(([k], i) => `#c${i} :c${i}`).join(", "),
        ExpressionAttributeNames: {
          "#domain": "domain",
          "#day": "day",
          ...Object.fromEntries(entries.map(([k], i) => [`#c${i}`, k])),
        },
        ExpressionAttributeValues: {
          ":domain": domain,
          ":day": day,
          ":now": new Date().toISOString(),
          ...Object.fromEntries(entries.map(([, n], i) => [`:c${i}`, n])),
        },
      },
    },
  ];
}
export function eventMetric(msg: Message, event: DeliveryEvent) {
  const previous = (msg.metricOutcomes ?? {}) as Partial<
    Record<MetricKey, string[]>
  >;
  const seen = new Set(previous[event.type] ?? []);
  const recipients = [
    ...new Set(event.recipients.map((r) => r.toLowerCase())),
  ].filter((r) => msg.input.to.includes(r) && !seen.has(r));
  return {
    increments: { [event.type]: recipients.length },
    outcomes: { ...previous, [event.type]: [...seen, ...recipients] },
  };
}
export async function readMetrics(
  store: Store,
  length: number,
  domain?: string,
): Promise<MetricsSnapshot> {
  const dates = Array.from({ length }, (_, i) =>
    new Date(Date.now() - (length - 1 - i) * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const days: MetricsSnapshot["days"] = [],
    domains = new Map<string, Counts>(),
    totals = emptyCounts();
  // Bounded, strongly consistent partition queries; never scans messages or calls CloudWatch.
  for (const day of dates) {
    const rows = domain
      ? [
          await store.get<MetricRow>(`METRICS#${day}`, `DOMAIN#${domain}`),
        ].filter((r): r is MetricRow => !!r)
      : await store.children<MetricRow>(`METRICS#${day}`, "DOMAIN#", 10001);
    if (rows.length > 10000)
      throw new Error("Too many metric domains; select a domain");
    const counts = emptyCounts();
    for (const row of rows) {
      const domainCounts = domains.get(row.domain) ?? emptyCounts();
      for (const key of metricKeys) {
        const value = Number(row[key] ?? 0);
        counts[key] += value;
        totals[key] += value;
        domainCounts[key] += value;
      }
      domains.set(row.domain, domainCounts);
    }
    days.push({ day, counts });
  }
  const metadata = await store.get("METRICS");
  return {
    mode: store.config.NARADA_MODE,
    fetchedAt: new Date().toISOString(),
    startedAt: (metadata?.startedAt as string) ?? null,
    days,
    totals,
    domains: [...domains].map(([domain, counts]) => ({ domain, counts })),
    cloudWatchUrl: `https://${store.config.AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${store.config.AWS_REGION}#metricsV2:graph=~();namespace=AWS/SES`,
  };
}

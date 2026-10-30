import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    from: { type: "string" },
    count: { type: "string", default: "100" },
    replay: { type: "boolean", default: false },
  },
});
const origin = new URL(values.origin ?? process.env.NARADA_BASE_URL ?? "");
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== "/"
)
  throw new Error(
    "Use an HTTPS origin without a path, credentials, query or fragment",
  );
if (!values.from || /[\r\n]/.test(values.from))
  throw new Error("Pass --from with an approved sender on a verified domain");
const count = Number(values.count);
if (!Number.isInteger(count) || count < 1 || count > 1000)
  throw new Error("count must be 1–1000");
const token = process.env.NARADA_API_KEY;
if (!token || /[\r\n]/.test(token))
  throw new Error("Supply NARADA_API_KEY in the server environment");
const run = randomUUID();
const body = JSON.stringify({
  from: values.from,
  to: "success@simulator.amazonses.com",
  subject: "Narada acceptance latency probe",
  text: "Synthetic SES simulator message. No authentication tokens or user data.",
  expires_in: 300,
});
interface Sample {
  status: number;
  cold: boolean | null;
  totalMs: number;
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  ttfbMs: number;
  handlerMs?: number;
  setupMs?: number;
  messageId?: string;
  requestId?: string;
  gatewayRequestId?: string;
  edge?: string;
  curlExit: number | null;
  outcome: "accepted" | "rejected" | "unknown";
}
const samples: Sample[] = [];
function quantiles(rows: Sample[]) {
  const a = rows.map((r) => r.totalMs).sort((a, b) => a - b);
  if (!a.length) return { n: 0 };
  return {
    n: a.length,
    p50: a[Math.ceil(a.length * 0.5) - 1],
    p95: a[Math.ceil(a.length * 0.95) - 1],
    p99: a[Math.ceil(a.length * 0.99) - 1],
    max: a.at(-1),
  };
}
await mkdir(".local", { recursive: true });
const output = `.local/submission-latency-${run}.json`;
async function save() {
  const accepted = samples.filter((s) => s.outcome === "accepted");
  const report = {
    at: new Date().toISOString(),
    origin: origin.origin,
    replay: values.replay,
    note: "Sequential fresh-connection probes from this machine, not a Supabase hook or an SLO proof. Cold classification requires the instrumented Lambda Server-Timing header. p99 for small cohorts is effectively the maximum. No automatic retries.",
    attempted: samples.length,
    failed: samples.length - accepted.length,
    unknown: samples.filter((s) => s.outcome === "unknown").length,
    accepted: quantiles(accepted),
    cold: quantiles(accepted.filter((s) => s.cold === true)),
    warm: quantiles(accepted.filter((s) => s.cold === false)),
    unclassified: quantiles(accepted.filter((s) => s.cold === null)),
    samples,
  };
  await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}
for (let i = 0; i < count; i++) {
  const config = [
    `url = ${JSON.stringify(`${origin.origin}/api/v1/emails`)}`,
    `request = "POST"`,
    `header = ${JSON.stringify(`Authorization: Bearer ${token}`)}`,
    `header = "Content-Type: application/json"`,
    `header = ${JSON.stringify(`Idempotency-Key: probe-${run}-${values.replay ? 0 : i}`)}`,
    `data = ${JSON.stringify(body)}`,
  ].join("\n");
  // stdin avoids putting credentials in process arguments or temporary files.
  const result = spawnSync(
    "curl",
    [
      "--config",
      "-",
      "--silent",
      "--show-error",
      "--max-time",
      "10",
      "--dump-header",
      "/dev/fd/3",
      "--write-out",
      "\n%{json}",
    ],
    {
      input: config,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    },
  );
  const lines = (result.stdout ?? "").trim().split("\n");
  let timing: Record<string, number> = {};
  try {
    timing = JSON.parse(lines.pop() || "{}");
  } catch {
    // Missing curl timing output is an unknown result, never a reason to resend.
  }
  let accepted: { id?: string } = {};
  if (timing.http_code === 202) {
    try {
      accepted = JSON.parse(lines.join("\n"));
    } catch {
      /* An unreadable acceptance is an unknown outcome; do not resend. */
    }
  }
  const headers = new Map(
    String(result.output[3] ?? "")
      .split(/\r?\n/)
      .filter((line) => line.includes(":"))
      .map((line) => {
        const i = line.indexOf(":");
        return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()];
      }),
  );
  const serverTiming = headers.get("server-timing") ?? "";
  samples.push({
    status: timing.http_code ?? 0,
    curlExit: result.status,
    outcome:
      result.status !== 0 ||
      !timing.http_code ||
      (timing.http_code === 202 && typeof accepted.id !== "string")
        ? "unknown"
        : timing.http_code === 202
          ? "accepted"
          : "rejected",
    cold: /cold;desc="true"/.test(serverTiming)
      ? true
      : /cold;desc="false"/.test(serverTiming)
        ? false
        : null,
    totalMs: 1000 * (timing.time_total ?? 0),
    dnsMs: 1000 * (timing.time_namelookup ?? 0),
    tcpMs: 1000 * ((timing.time_connect ?? 0) - (timing.time_namelookup ?? 0)),
    tlsMs: 1000 * ((timing.time_appconnect ?? 0) - (timing.time_connect ?? 0)),
    ttfbMs: 1000 * (timing.time_starttransfer ?? 0),
    handlerMs: serverTiming.match(/handler;dur=([\d.]+)/)
      ? Number(serverTiming.match(/handler;dur=([\d.]+)/)![1])
      : undefined,
    setupMs: serverTiming.match(/setup;dur=([\d.]+)/)
      ? Number(serverTiming.match(/setup;dur=([\d.]+)/)![1])
      : undefined,
    messageId: accepted.id,
    requestId: headers.get("x-request-id"),
    gatewayRequestId: headers.get("apigw-requestid"),
    edge: headers.get("x-amz-cf-pop"),
  });
  await save();
  if ((i + 1) % 20 === 0) console.log(`Completed ${i + 1}/${count} probes`);
  if (i + 1 < count) await new Promise((r) => setTimeout(r, 650));
}
const { samples: _, origin: __, ...summary } = await save();
console.log(JSON.stringify(summary, null, 2));
console.log(`Private metadata report: ${output}`);

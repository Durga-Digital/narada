import { useEffect, useState } from "react";
import type {
  Page,
  SendApproval,
  SendApprovalReview,
} from "@narada/contracts/types";
import { api } from "../../lib/api.js";
import { Notice, PageHeading } from "../../components/shared.js";
import { Button } from "../../components/ui/button.js";
import { EmailPreview } from "../email-editor/email-preview.js";

export function Approvals() {
  const [version, setVersion] = useState(0);
  const [cursor, setCursor] = useState("");
  const [page, setPage] = useState<Page<SendApproval>>();
  const [selected, setSelected] = useState(
    () => new URLSearchParams(location.search).get("approvalId") ?? "",
  );
  const [recipient, setRecipient] = useState("");
  const [detail, setDetail] = useState<SendApprovalReview>();
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  useEffect(() => {
    let active = true;
    setListLoading(true);
    setListError("");
    api<Page<SendApproval>>(
      `approvals?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    )
      .then((value) => {
        if (active) setPage(value);
      })
      .catch((e) => {
        if (active) setListError(e.message);
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cursor, version]);
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setError("");
    if (!selected) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<SendApprovalReview>(
      `approvals/${encodeURIComponent(selected)}${recipient ? `?recipient=${encodeURIComponent(recipient)}` : ""}`,
    )
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected, recipient, version]);
  async function decide(approve: boolean) {
    if (!detail?.digest || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<SendApproval>(
        `approvals/${encodeURIComponent(detail.id)}/${approve ? "approve" : "reject"}`,
        { digest: detail.digest },
      );
      setDetail(result);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not record your decision. Refresh the request to check its status.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Send approvals"
        description="Review what a connected client wants to send or publish. Nothing is sent until you approve."
      />
      <p className="text-sm text-muted-foreground mb-5">
        Review the sender, content, recipients and timing. Requests expire after
        24 hours. Changes to content or audience require a new review.
      </p>
      <Button
        variant="outline"
        disabled={busy || loading || listLoading}
        onClick={() => setVersion((v) => v + 1)}
      >
        Refresh approvals
      </Button>
      <Notice>{listError}</Notice>
      {listLoading ? (
        <p role="status">Loading approvals…</p>
      ) : page?.data.length === 0 ? (
        <p className="my-4">No approval requests on this page.</p>
      ) : null}
      {page ? (
        <div className="overflow-x-auto rounded-lg border my-4">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">Send approval requests</caption>
            <thead className="bg-muted">
              <tr>
                <th className="p-3">Action</th>
                <th className="p-3">Status</th>
                <th className="p-3">Requested</th>
                <th className="p-3">Review</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3">{row.operation}</td>
                  <td className="p-3">{row.status}</td>
                  <td className="p-3">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={`Review approval ${row.id}`}
                      onClick={() => {
                        setSelected(row.id);
                        setRecipient("");
                      }}
                    >
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex gap-2 mb-6">
        <Button
          variant="outline"
          disabled={busy || listLoading || !cursor}
          onClick={() => setCursor("")}
        >
          Newest
        </Button>
        <Button
          variant="outline"
          disabled={busy || listLoading || !page?.nextCursor}
          onClick={() => setCursor(page?.nextCursor ?? "")}
        >
          Older approvals
        </Button>
      </div>
      <Notice>{error}</Notice>
      {loading ? <p role="status">Loading review…</p> : null}
      {detail ? (
        <section
          className="rounded-lg border p-5 space-y-4"
          aria-label="Send review"
        >
          <h2 className="text-lg font-medium">
            {detail.operation} · {detail.status}
          </h2>
          <p className="text-sm break-all">
            Requested by{" "}
            {detail.requestedBy.kind === "oauth"
              ? `MCP client ${detail.requestedBy.clientId}`
              : `API key ${detail.requestedBy.keyId}`}
          </p>
          {detail.status === "pending" && detail.digest ? (
            <>
              <dl className="text-sm space-y-2 break-words">
                <div>
                  <dt className="font-medium">From</dt>
                  <dd>{detail.from}</dd>
                </div>
                {detail.replyTo ? (
                  <div>
                    <dt className="font-medium">Reply to</dt>
                    <dd>{detail.replyTo}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-medium">Subject</dt>
                  <dd>{detail.subject}</dd>
                </div>
                <div>
                  <dt className="font-medium">Timing</dt>
                  <dd>
                    {detail.scheduledAt
                      ? new Date(detail.scheduledAt).toLocaleString()
                      : "Immediately after approval"}
                  </dd>
                </div>
                {detail.priority ? (
                  <div>
                    <dt className="font-medium">Priority</dt>
                    <dd>{detail.priority}</dd>
                  </div>
                ) : null}
                {detail.expiresInSeconds !== undefined ? (
                  <div>
                    <dt className="font-medium">Delivery expiry</dt>
                    <dd>{detail.expiresInSeconds} seconds after acceptance</dd>
                  </div>
                ) : null}
                {detail.tags && Object.keys(detail.tags).length ? (
                  <div>
                    <dt className="font-medium">Tags</dt>
                    <dd>
                      <pre className="whitespace-pre-wrap">
                        {JSON.stringify(detail.tags, null, 2)}
                      </pre>
                    </dd>
                  </div>
                ) : null}
                {detail.channels ? (
                  <div>
                    <dt className="font-medium">Channels</dt>
                    <dd>{detail.channels}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-medium">
                    Recipients ({detail.recipients?.length ?? 0})
                  </dt>
                  <dd className="max-h-40 overflow-auto whitespace-pre-wrap">
                    {detail.recipients?.join("\n") ||
                      "Web publication only; no email recipients"}
                  </dd>
                </div>
              </dl>
              {(detail.recipients?.length ?? 0) > 1 ? (
                <label className="block text-sm font-medium">
                  Preview recipient
                  <select
                    className="block border rounded p-2 mt-1 max-w-full"
                    value={detail.previewRecipient ?? ""}
                    disabled={busy}
                    onChange={(e) => setRecipient(e.target.value)}
                  >
                    {detail.recipients!.map((email) => (
                      <option key={email} value={email}>
                        {email}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {detail.html ? (
                <EmailPreview
                  html={detail.html}
                  title="Approved message preview"
                />
              ) : null}
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Plain text content
                </summary>
                <pre className="whitespace-pre-wrap break-words text-sm p-3 bg-muted">
                  {detail.text}
                </pre>
              </details>
              {detail.webHtml && detail.channels === "both" ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    Web publication preview
                  </summary>
                  <EmailPreview
                    html={detail.webHtml}
                    title="Approved web publication preview"
                  />
                </details>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Approving accepts this exact send or publication. Delivery can
                still fail, and recipients who opt out or become suppressed are
                excluded during delivery.
              </p>
              <div className="flex gap-3">
                <Button disabled={busy || loading} onClick={() => decide(true)}>
                  {busy
                    ? "Recording decision…"
                    : detail.channels === "web"
                      ? "Approve and publish"
                      : "Approve and send"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || loading}
                  onClick={() => decide(false)}
                >
                  Reject
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Review expires {new Date(detail.expiresAt).toLocaleString()}.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm">
                {detail.status === "succeeded"
                  ? "Your approved action was accepted. Check activity for execution and delivery status."
                  : detail.status === "unknown"
                    ? "The outcome is uncertain. Inspect activity and delivery before requesting another send."
                    : detail.status === "executing"
                      ? "This approval is being processed. Refresh to check its status."
                      : detail.status === "expired"
                        ? "This review expired. Ask the client to prepare a new request."
                        : "This request was rejected."}
              </p>
              {detail.messageId ? (
                <p className="text-sm break-all">
                  Message ID: {detail.messageId}
                </p>
              ) : null}
              {detail.operationId ? (
                <a
                  className="underline text-sm"
                  href={`/?page=activity&operationId=${encodeURIComponent(detail.operationId)}`}
                >
                  View operation activity
                </a>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </>
  );
}

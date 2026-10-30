# Message content retention

Narada retains HTML/plain-text bodies only while it needs them for submission or an automatic retry. Delivery tracking uses metadata and SES events, so bodies are deleted after provider acceptance, without waiting for a delivery receipt.

| Message state                                           | Body retained?                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| Queued, including retriable throttling                  | Yes, until processed or expired                                       |
| Submitting                                              | Yes, until submission resolves or the stale worker lease is recovered |
| Sent, captured, delivered, delayed, bounced, complained | No                                                                    |
| Failed, expired, unknown (no automatic retry)           | No                                                                    |

Status changes and body removal are atomic. Feedback updates only delivery fields and cannot restore an older body. Recovery of an abandoned submission marks it unknown and removes its body. The dispatcher and workers must be running for queued expiration and abandoned-submission recovery; this is operational cleanup, not an exact timed erasure guarantee.

Sender, recipients, subject, reply-to, attempts, provider ID, status and events remain under the message's existing 30-day DynamoDB TTL. Idempotency behavior is unchanged. A terminal message cannot be replayed from stored content; the consuming application must supply a new message. Never put codes or bearer tokens in subjects or address fields.

## Clean up records created before this change

Deploy the new worker and feedback handler first and allow old in-flight invocations to finish. An old handler could otherwise restore a body from a stale read. The cleanup command uses the deployment configuration, verifies the AWS account, and resolves the application table from the live CloudFormation stack. It queries the current `default` project with pagination; it does not scan the whole table or print message content.

Authenticate with the appropriate AWS SSO profile, then preview eligible completed records:

```sh
aws sso login --profile narada-staging
pnpm messages:purge-content --stage staging
```

After reviewing the reported account, region, table and count, apply:

```sh
pnpm messages:purge-content --stage staging --apply
```

Repeat for production:

```sh
aws sso login --profile narada-production
pnpm messages:purge-content --stage production
pnpm messages:purge-content --stage production --apply
```

Without `--apply`, the command is read-only. Applied updates recheck eligibility atomically, preserve metadata, and skip active queued/submitting records. Repeating the command is safe; rerun the dry run afterward to confirm no eligible content remains. The index is eventually consistent, so allow it to catch up before verification. If a run is interrupted, rerun it.

This removes `input.html`, `input.text` and per-recipient `broadcast.unsubscribeUrl` from live message records. It does not delete authoring content in templates/broadcasts, form responses, independent copies, recipient inboxes or Mailpit. Existing backups/PITR may retain previous bodies until their retention window expires. After restoring an older backup, run cleanup before exposing the restored application. Treat backup access as privileged access to potentially sensitive content.

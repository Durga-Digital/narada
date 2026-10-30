# Narada product requirements

> Historical scope and acceptance record. Dated status statements describe that increment, not current hosted or npm availability. For current source behavior, start with [README](../README.md) and [documentation index](README.md).

## Purpose

Replace a small application's hosted transactional-email dependency with a private, inexpensive AWS installation. Initial planning volume: 1,000 transactional emails/month. Narada is named for the divine messenger Narada.

## Users and scope

One owner operates one private workspace. Applications authenticate with revocable API keys. The owner signs in with Better Auth, can enable an authenticator and recovery codes, and can reset their password by email. Public registration is disabled.

The product sends transactional messages and audience broadcasts such as newsletters and announcements. Broadcasts include consent-attested CSV imports, drafts, visual block and text/HTML editing, previews, test sends, scheduling, cancellation, and audience-specific unsubscribes, typed contact properties, personalization, manual/dynamic segments, and topic preference management. Reusable templates provide a searchable library, shared editor, typed variables, previews/test sends, immutable publication, SDK sends, and broadcast copies. Inbound processing, subscription billing, attachments, automations, and full Resend SDK compatibility remain outside scope.

## Requirements and acceptance criteria

| Capability           | Acceptance criteria                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Local setup          | `pnpm dev` creates a usable environment without AWS credentials; data survives restarts.                                                 |
| Dashboard            | shadcn components, responsive navigation, clear loading/error/empty states, latest 100 messages and status counts.                       |
| Sending              | Text/HTML via API, text compose UI, 1–10 recipients, sender-domain validation, reply-to, expiry.                                         |
| Idempotency          | Same key and payload within 24 hours returns the existing message; changed content returns 409; concurrent calls create one message.     |
| Durable processing   | API returns after a durable database write; workers claim conditionally; outbox recovery handles lost queue publication.                 |
| Feedback             | Delivery, delay, hard bounce, complaint and rejection update history; duplicates have no extra side effects.                             |
| Recipient protection | Permanent bounce/complaint suppress recipients; worker rechecks immediately before submission.                                           |
| Webhooks             | HMAC signatures, retries, attempt history, manual failed-attempt retry, private-network blocking and DNS pinning.                        |
| Credentials          | API keys stored as hashes, shown once, revocable; sessions in database; MFA and password reset supported.                                |
| Deployment           | Code provisions AWS infrastructure and creates an owner; DNS verification and SES approval remain external prerequisites.                |
| Maintenance          | Strict TypeScript, feature-organized frontend, separate domain/transport/runtime boundaries, meaningful unit/integration/browser checks. |

## Success measures

- A clean checkout can send a captured message locally in a few commands.
- The browser-to-queue-to-Mailpit flow and feedback/webhook flow pass automatically.
- Duplicate queue delivery cannot cause a second submission after a successful conditional claim.
- A deployment does not require an always-on database, NAT gateway, or an external authentication service.
- AWS SES production access and domain verification are the remaining steps before actual external delivery.

## Next increments

1. Live AWS deployment rehearsal and SES mailbox simulator checks.
2. Pagination beyond 100 records, recipient-specific delivery summaries, richer operational alert setup and reconciliation UI.
3. Attachments, reusable template partials, per-domain API-key scopes and team roles if required.
4. Extend broadcasts beyond 1,000-contact audiences; add double-opt-in signup, nested segment rules, image hosting, and preference-page branding.

# SES onboarding: staging tests and production sending

Complete this after deploying Narada, before relying on email delivery or password resets. A successful CDK deployment does not grant SES production access. These are operator steps; CI does not submit an access request or verify recipient inboxes.

## Environment names and SES access are independent

SES sandbox status belongs to an **AWS account and region**, not a Narada stage name. Deploying to an account named `narada-production` does not remove its sandbox restrictions. Domain verification and production access are separate checks.

| Installation | Recommended SES setup          | Who can receive email                                       |
| ------------ | ------------------------------ | ----------------------------------------------------------- |
| Local        | Mailpit                        | Messages are captured locally                               |
| Staging      | Sandbox                        | Verified test recipients or SES mailbox simulator addresses |
| Production   | AWS-approved production access | Recipients do not need individual SES verification          |

Sandbox accounts are limited to 200 recipients per rolling 24 hours and one recipient per second. Production access still has sending quotas; inspect the account's actual limits rather than assuming unlimited sending. Sender identities must be verified in either mode.

## 1. Check the target account and region

The examples use this repository's profile names and Sydney region. Self-hosters must substitute their own profiles, region, domains, and inboxes. Do not copy another installation's account IDs or DKIM tokens.

```sh
aws sts get-caller-identity --profile narada-staging
aws sesv2 get-account \
  --profile narada-staging --region us-east-1 \
  --query '{productionAccess:ProductionAccessEnabled,sending:SendingEnabled,quota:SendQuota}'
```

Repeat with `--profile narada-production` for production. `ProductionAccessEnabled: false` means sandbox. Narada's **Settings → Amazon SES** also shows account access and quotas. Being healthy or having sending enabled does not mean production access has been approved.

## 2. Verify the sending domain in each environment

1. Sign in to the target Narada deployment and add the domain under **Domains**.
2. Publish its displayed DKIM CNAME records with the domain's **authoritative DNS provider**. Check `dig +short NS example.com` if unsure. Website hosting, domain registration, and DNS hosting can be different providers: records entered in Vercel have no public effect if the active nameservers belong to Cloudflare.
3. For Cloudflare, set DKIM CNAMEs to **DNS only**, not proxied. TXT and MX records do not have a proxy setting. Use the exact names and values shown, avoiding an accidentally repeated domain suffix.
4. Publish the DMARC TXT policy. If using custom MAIL FROM, save that setting in Narada and publish its displayed MX/SPF TXT records on a dedicated bounce subdomain. Preserve existing inbox MX records.
5. Click **Check verification**. Narada refreshes on request. SES verification can take up to 72 hours after the correct records are published. Missing or incorrect records will not be fixed by waiting.

For the same domain in staging and production, add each account's DKIM records alongside the others. Do not replace staging records with production records. Each account/region needs its own verified identity. Publish only one DMARC policy at a given name.

For password-reset emails, select a verified domain in **Profile → Security**. Until a sender is saved there, verify the identity used by `AUTH_FROM`. The owner inbox is also subject to the recipient restrictions below. See [profile and account security](PROFILE-SECURITY.md). See [domain authentication](DOMAIN-AUTHENTICATION.md) for DKIM, DMARC, and custom MAIL FROM details.

## 3. Verify a staging test recipient

Use an inbox you control. The following command **sends an AWS verification email** to the supplied address; it does not immediately verify it:

```sh
aws sesv2 create-email-identity \
  --email-identity tester@example.com \
  --profile narada-staging --region us-east-1
```

Open that inbox and click AWS's confirmation link, then check:

```sh
aws sesv2 get-email-identity \
  --email-identity tester@example.com \
  --profile narada-staging --region us-east-1 \
  --query '{verified:VerifiedForSendingStatus,status:VerificationStatus}'
```

If the identity already exists, inspect its status first. If it is pending and another verification email is needed, an operator can request one with `aws ses verify-email-identity --email-address tester@example.com --profile narada-staging --region us-east-1`.

Once verified, send a **new** domain test in Narada. A previously failed message is not automatically resent. Recipient verification applies only to that AWS account/region; it does not create a Narada user or an audience contact. Recipients covered by a verified domain do not need separate email-address verification.

For automated delivery-event tests, SES provides `success@simulator.amazonses.com` without recipient verification. It simulates delivery and does not let you inspect a real inbox or prove inbox placement.

## 4. Request production access

Verify a production sender domain first; AWS recommends this before requesting access. Then prepare:

- The public website for the application/business sending email.
- The dominant email type: **Transactional** for user-triggered messages such as password resets and receipts, or **Marketing** if that represents most sending.
- An operator contact email and preferred language.
- A truthful description of expected volume, how recipients request the messages, and bounce/complaint handling. For multiple applications, explain their relationship and use cases. Describe newsletters if they are part of the intended use.

Narada processes SES bounce/complaint events and suppresses further sends after permanent bounces or complaints. Confirm that event processing works in your deployment before relying on that statement in an application.

In the **production AWS account**, open **SES → Sydney (or your chosen region) → Account dashboard → Get set up → Request production access**. Complete the form and its acknowledgement about requested mail and bounce/complaint handling.

Alternatively, an authorized operator can submit through the CLI after replacing the example values:

```sh
aws sesv2 put-account-details \
  --production-access-enabled \
  --mail-type TRANSACTIONAL \
  --website-url https://example.com \
  --additional-contact-email-addresses operator@example.com \
  --contact-language EN \
  --profile narada-production --region us-east-1
```

This submits a review request, not an immediate sandbox switch. Do not run it as a smoke test or add it to every deployment. AWS may ask for further details through its support process. It states an initial response within 24 hours; approval is not guaranteed within that period. Account details cannot be edited while the review is underway.

Inspect progress and the resulting sending limits:

```sh
aws sesv2 get-account \
  --profile narada-production --region us-east-1 \
  --query '{productionAccess:ProductionAccessEnabled,review:Details.ReviewDetails,sending:SendingEnabled,quota:SendQuota}'
```

After approval, refresh Narada's SES settings, send a controlled real-inbox test, and verify delivery feedback and message authentication. Customers do not need to click SES verification links. Your own signup/consent requirements still apply. Keep staging in sandbox unless it has a specific need for unrestricted recipient testing.

## Troubleshooting a rejected test

Narada's **Test queued** or **Accepted** state means the application accepted the job; SES can still reject it later. The current email details may display only `MessageRejected`, which can have multiple causes.

Check the same account and region used by the deployment:

1. Is the sending domain verified, and is sending enabled?
2. If still in sandbox, is the recipient verified there?
3. If custom MAIL FROM uses **Reject sending until fixed**, is its MX verification successful?
4. Are the account's sending quotas or other SES restrictions blocking delivery?

Never assume that verifying the sender also verifies the recipient or removes the sandbox. Retry with a new test after resolving a definite rejection; investigate uncertain delivery outcomes before resending.

References: [AWS production-access process](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), [identity verification](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html), [SES mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html), [Vercel DNS management](https://vercel.com/docs/domains/managing-dns-records).

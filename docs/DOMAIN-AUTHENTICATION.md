# Domain authentication

Open **Domains**, select a domain, and work through the four setup tabs. **Check verification** updates the stored SES and DNS snapshot. The identity badge means SES permits sending from the domain; it does not certify all authentication or inbox placement.

## DKIM

The DNS setup tabs default to **Short host — Squarespace / auto-appends domain**. Confirm the **DNS zone** matches the domain whose DNS page you are editing. Narada suggests the registrable domain, but a delegated subdomain may have its own zone. For `token._domainkey.mail.example.com` in the `example.com` zone, copy `token._domainkey.mail`; in a separate `mail.example.com` zone, copy `token._domainkey`. Squarespace appends the zone automatically, so pasting the full name can publish an incorrect `...example.com.example.com` record.

Choose **Full record name** for providers that require it. Individual host copies and **Copy all records** use the selected format; destination values remain complete. Every record also shows its full DNS name for comparison. An unrelated or invalid zone disables short-host copying. These controls apply to DKIM, proposed DMARC records, and MAIL FROM MX/TXT records, and only change copy formatting—not saved SES settings or DNS. Publish with your active DNS provider; Narada cannot prevent a manual paste into the wrong field.

Publish the CNAME records displayed in Narada. Use **Check verification** until SES reports successful DKIM and enabled signing. If signing is disabled, **Enable DKIM signing** changes it through SES. Existing externally managed DKIM keys are not replaced. Local mode cannot generate real SES tokens and shows a preview only.

## DMARC

Narada looks for `_dmarc.<sender-domain>`, then the organizational-domain policy if none is found. The public-suffix list handles boundaries such as `example.co.uk`. An inherited `sp` policy is shown when applicable. Duplicate or malformed policies require review; a DNS timeout is unknown, not missing.

Start a new proposal with `p=none`. Add an optional mailbox you already manage to request aggregate reports. Narada does not provision or read that mailbox; reporting to an external domain may require additional DNS authorization. An existing policy is displayed so you can preserve it. Publishing an explicit subdomain policy overrides inherited policy. Check every service sending as the domain before moving to quarantine or reject. This tool checks common syntax and discovery, not all DMARC extensions or the authentication results of a particular message.

The generator only prepares text to copy. No DNS changes happen until you publish the record with your DNS provider. Publish one DMARC policy per name.

## Custom MAIL FROM / SPF

Custom MAIL FROM is optional when aligned DKIM satisfies DMARC. Use a dedicated unused subdomain, such as `bounce.mail.example.com`, under the sending identity `mail.example.com`. Do not use a domain that receives ordinary email or a registered Narada sending identity.

Save the configuration in Narada, then publish the shown MX and TXT records. For MX, put `10` in the priority field and the hostname in the mail-server field. SES requires exactly one MX entry. Narada compares the SPF TXT record to the suggested dedicated SES policy; it does not recursively evaluate arbitrary SPF include chains.

- **Fall back to SES default:** messages can continue using SES's return path if custom MX verification fails. This loses custom SPF alignment; aligned DKIM can still satisfy DMARC.
- **Reject sending until fixed:** SES rejects attempts while MAIL FROM verification is pending or failed. Select this deliberately because initial DNS propagation can interrupt sending.

A custom subdomain provides relaxed SPF alignment. Strict `aspf=s` generally cannot align that subdomain with the visible sender domain; aligned DKIM can still satisfy DMARC.

Set the mode back to **SES default** and save to disable custom MAIL FROM. DNS records are retained. Changing MAIL FROM or enabling DKIM can affect other senders using the same SES identity. Narada changes the identity in its configured AWS region only. If a save response is lost, refresh verification before retrying: SES may already have applied the change.

## Test and reputation

Send a test to an inbox you control. Local messages go to Mailpit through the same durable queue as regular email; they do not validate public DNS or internet delivery. In AWS, sandbox rules and sending limits still apply. Inspect message headers in the destination inbox for SPF, DKIM and DMARC. Narada cannot inspect that inbox, and a delivered event only means its mail server accepted the message.

Reputation is not a configuration toggle. Send expected messages, increase new-domain volume gradually, and monitor bounces and complaints in Metrics. Narada's existing suppression handling protects against repeat sends after permanent bounces or complaints. This checklist does not add automatic domain warm-up scheduling or promise inbox placement.

## Deployment

For first-time AWS setup, follow [SES onboarding: staging tests and production sending](SES-ONBOARDING.md). It explains where to publish DNS, how to verify sandbox test recipients, and how to request production access separately for each account/region.

Re-deploy existing installations so the API role receives `ses:PutEmailIdentityMailFromAttributes` and `ses:PutEmailIdentityDkimAttributes`, scoped to identities in the deployment's AWS account and region. No Route 53 write access or CloudWatch metrics polling is added. SES production access still requires AWS approval. Local tests and infrastructure synthesis do not replace validation in the target AWS account.

References: [AWS custom MAIL FROM](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html), [AWS DMARC guidance](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html), [AWS DKIM signing API](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_PutEmailIdentityDkimAttributes.html).

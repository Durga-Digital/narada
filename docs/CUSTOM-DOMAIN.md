# Custom dashboard domain

A custom domain is optional. The default CloudFront URL works for both the dashboard and SDK base URL. These steps use `mail.example.com`; substitute a hostname you control.

## Certificate and DNS

1. In the deployment's AWS account, request an ACM public certificate for your hostname in **us-east-1** (required by CloudFront), using DNS validation.
2. Copy ACM's exact validation CNAME name and value into your authoritative DNS provider. If the provider automatically appends your zone, remove only the final zone suffix from the Host field. For example `_token.mail.example.com.` becomes `_token.mail` in the `example.com` zone. Keep the full target value.
3. Wait for ACM status `ISSUED`. Keep the validation CNAME for certificate renewal.
4. Set `NARADA_CUSTOM_DOMAIN=mail.example.com` and `NARADA_CERTIFICATE_ARN` to the issued certificate ARN when previewing and deploying. Both settings are required together. The certificate account must match the deployment account.

Use `pnpm run deploy --stage production --plan`, review the changes, then deploy with the same environment variables. Copy the `CloudFrontDomainName` stack output and create a DNS-only CNAME from `mail` to that distribution hostname. Do not copy a hostname or certificate from another installation.

For GitHub releases, save both custom-domain settings as variables in the corresponding GitHub environment so later releases preserve the configuration. Keep staging and production values separate.

## Verification

Wait for DNS and the CloudFront deployment to complete. Open `https://mail.example.com`, verify the certificate, sign in and check the API. Set consuming applications' SDK base URL to the origin alone (`https://mail.example.com`, without `/api/v1`). The deployment updates the application's public auth origin; verify password-reset links after the change.

A dashboard hostname is separate from an SES sending identity. Configure DKIM/DMARC and optional MAIL FROM for sending domains through Narada's domain setup, even if the dashboard already has valid HTTPS.

## Recovery

Keep your prior deployment configuration and inspect the CDK diff before changing domains. DNS changes alone do not update CloudFront aliases or the authentication origin. Roll back the configuration and application deployment together if required; preserve the certificate validation record while the certificate remains in use.

## Custom publication subdomains

See [publication subdomains](PUBLICATION-DOMAINS.md) for the five shared management operations, dedicated domain-write consent, DNS/HTTPS setup, asynchronous recovery and default-address fallback. The local implementation includes dashboard, API, SDK and MCP coverage; deployment and SDK publication are separate release steps. DNS-provider writes remain an operator action.

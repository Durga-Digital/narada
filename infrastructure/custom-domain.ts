/** External DNS is managed by the domain owner, not this application stack. */
export function customDomainConfig(env: NodeJS.ProcessEnv, account: string) {
  const domainName = env.NARADA_CUSTOM_DOMAIN?.trim();
  const certificateArn = env.NARADA_CERTIFICATE_ARN?.trim();
  if (!domainName && !certificateArn) return undefined;
  if (!domainName || !certificateArn)
    throw new Error(
      "Set NARADA_CUSTOM_DOMAIN and NARADA_CERTIFICATE_ARN together",
    );
  if (
    domainName.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domainName)
  )
    throw new Error(
      "NARADA_CUSTOM_DOMAIN must be a lowercase DNS hostname without a scheme, path, or wildcard",
    );
  if (
    !new RegExp(
      `^arn:aws:acm:us-east-1:${account}:certificate/[a-f0-9-]{36}$`,
    ).test(certificateArn)
  )
    throw new Error(
      "CloudFront certificate must be in us-east-1 in the deployment account",
    );
  return { domainName, certificateArn, origin: `https://${domainName}` };
}

// Hostnames only: each DNS label is 1–63 characters, with no leading/trailing hyphen.
export const domainNamePattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const normalizeDomainName = (name: string) => name.trim().toLowerCase();
export const validDomainName = (name: string) =>
  name.length <= 253 && domainNamePattern.test(name);

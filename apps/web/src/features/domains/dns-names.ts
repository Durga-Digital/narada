export type DnsNameSettings = { zone: string; format: "relative" | "full" };

export function normalizeDnsZone(zone: string) {
  return zone.trim().toLowerCase().replace(/\.$/, "");
}

// Strip only a whole DNS suffix, preserving subdomains below the selected zone.
export function dnsHost(
  name: string,
  settings: DnsNameSettings,
): string | null {
  const full = name.toLowerCase().replace(/\.$/, "");
  if (settings.format === "full") return full;
  const zone = normalizeDnsZone(settings.zone);
  if (!zone || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/.test(zone))
    return null;
  if (full === zone) return "@";
  return full.endsWith(`.${zone}`) ? full.slice(0, -(zone.length + 1)) : null;
}

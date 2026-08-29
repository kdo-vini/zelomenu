export function makeInternalCatalogRateLimitKey(empresaId: string, ip: string): string {
  return `${empresaId}:${ip}`;
}

export function makeCoarseInternalCatalogRateLimitKey(ip: string): string {
  return ip;
}

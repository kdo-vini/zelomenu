// Subset of zelochat's pixReceipt.ts — only normalizeComparableText is needed here.
// This function is the dependency of zelomenuDelivery.ts (FONTE ÚNICA, node-free).

export function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

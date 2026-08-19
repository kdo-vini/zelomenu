export function resolvePublicPushOrderId(order: { id: string } | null | undefined): string | undefined {
  return order?.id ?? undefined;
}

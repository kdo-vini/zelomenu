export function buildZeloMenuAutosaveSignature<T extends { expectedRevision: number }>(payload: T | null): string {
  if (!payload) return '';
  const { expectedRevision: _expectedRevision, ...content } = payload;
  return JSON.stringify(content);
}

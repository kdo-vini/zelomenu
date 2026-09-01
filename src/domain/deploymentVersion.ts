function normalizeVersion(version: string | undefined): string | undefined {
  const normalized = version?.trim();
  return normalized || undefined;
}

export function shouldReloadForDeployment(
  currentVersion: string | undefined,
  deployedVersion: string | undefined,
): boolean {
  const current = normalizeVersion(currentVersion);
  const deployed = normalizeVersion(deployedVersion);

  return Boolean(current && deployed && current !== deployed);
}

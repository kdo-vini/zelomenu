import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function readBuildVersion(): string | undefined {
  try {
    const info = JSON.parse(readFileSync(fileURLToPath(new URL('../BUILD_INFO.json', import.meta.url)), 'utf8'));
    return typeof info.version === 'string' && /^[a-f0-9]{40}(-dirty)?$/.test(info.version) ? info.version : undefined;
  } catch {
    // Development can run the source directly before its first build.
    return undefined;
  }
}

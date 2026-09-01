import { describe, expect, it } from 'vitest';
import { shouldReloadForDeployment } from './deploymentVersion';

describe('shouldReloadForDeployment', () => {
  it('reloads an open app when the deployed version changes', () => {
    expect(shouldReloadForDeployment('4e25c8e', 'a1b2c3d')).toBe(true);
  });

  it('does not reload when the version is unchanged or unavailable', () => {
    expect(shouldReloadForDeployment('4e25c8e', '4e25c8e')).toBe(false);
    expect(shouldReloadForDeployment('4e25c8e', undefined)).toBe(false);
    expect(shouldReloadForDeployment(undefined, 'a1b2c3d')).toBe(false);
  });
});

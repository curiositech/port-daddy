import { isManagedSecretKey, managedSecretKeys } from '../../lib/secret-env.js';

describe('coordination peer secret handling', () => {
  test('the cloud coordination macaroon is snapshotted and keychain-eligible', () => {
    expect(isManagedSecretKey('PORT_DADDY_COORDINATION_MACAROON')).toBe(true);
    expect(managedSecretKeys()).toContain('PORT_DADDY_COORDINATION_MACAROON');
  });
});

import {
  isManagedSecretKey,
  managedSecretKeys,
  withSecretsInChildEnv,
} from '../../lib/secret-env.js';

describe('coordination peer secret handling', () => {
  test('the complete Jira connection tuple is keychain-eligible', () => {
    for (const key of ['PD_JIRA_BASE_URL', 'PD_JIRA_PROJECT_KEY', 'PD_JIRA_EMAIL', 'PD_JIRA_API_TOKEN']) {
      expect(isManagedSecretKey(key)).toBe(true);
      expect(managedSecretKeys()).toContain(key);
    }
  });

  test('the cloud coordination macaroon is snapshotted and keychain-eligible', () => {
    expect(isManagedSecretKey('PORT_DADDY_COORDINATION_MACAROON')).toBe(true);
    expect(managedSecretKeys()).toContain('PORT_DADDY_COORDINATION_MACAROON');
  });

  test('child processes receive only their explicit managed-secret allow-list', () => {
    process.env.NGROK_AUTHTOKEN = 'ngrok-secret';
    process.env.PORT_DADDY_COORDINATION_MACAROON = 'coordination-secret';
    try {
      const child = withSecretsInChildEnv({}, ['NGROK_AUTHTOKEN']);
      expect(child.NGROK_AUTHTOKEN).toBe('ngrok-secret');
      expect(child.PORT_DADDY_COORDINATION_MACAROON).toBeUndefined();
    } finally {
      delete process.env.NGROK_AUTHTOKEN;
      delete process.env.PORT_DADDY_COORDINATION_MACAROON;
    }
  });
});

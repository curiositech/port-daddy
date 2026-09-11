import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { githubAppPrivateKeyDer } from '../src/github.js';

function fixtures(): { pkcs1: string; pkcs8: string; pkcs8Der: Uint8Array } {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  return {
    pkcs1: key.export({ type: 'pkcs1', format: 'pem' }) as string,
    pkcs8: key.export({ type: 'pkcs8', format: 'pem' }) as string,
    pkcs8Der: new Uint8Array(key.export({ type: 'pkcs8', format: 'der' })),
  };
}

describe('shared GitHub App key parser parity', () => {
  it('accepts PKCS#1, PKCS#8, escaped newlines, and base64-wrapped PEM', () => {
    const { pkcs1, pkcs8, pkcs8Der } = fixtures();
    expect(githubAppPrivateKeyDer(pkcs8)).toEqual(pkcs8Der);
    expect(githubAppPrivateKeyDer(pkcs1)).toEqual(pkcs8Der);
    expect(githubAppPrivateKeyDer(pkcs1.replace(/\n/g, '\\n'))).toEqual(pkcs8Der);
    expect(githubAppPrivateKeyDer(Buffer.from(pkcs8, 'utf8').toString('base64'))).toEqual(pkcs8Der);
  });

  it('rejects malformed and mislabeled key material', () => {
    const { pkcs1, pkcs8 } = fixtures();
    expect(() => githubAppPrivateKeyDer('-----BEGIN PRIVATE KEY-----\n!!!\n-----END PRIVATE KEY-----')).toThrow();
    expect(() => githubAppPrivateKeyDer(pkcs1
      .replace('BEGIN RSA PRIVATE KEY', 'BEGIN PRIVATE KEY')
      .replace('END RSA PRIVATE KEY', 'END PRIVATE KEY'))).toThrow(/PKCS#8/);
    expect(() => githubAppPrivateKeyDer(pkcs8
      .replace('BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY')
      .replace('END PRIVATE KEY', 'END RSA PRIVATE KEY'))).toThrow(/PKCS#1/);
    expect(() => githubAppPrivateKeyDer(`${pkcs8}\n${pkcs8}`)).toThrow(/one unencrypted/);
  });
});

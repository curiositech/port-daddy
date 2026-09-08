/**
 * Worker-safe GitHub App private-key parsing.
 *
 * GitHub currently downloads App keys as PKCS#1 PEM while Web Crypto imports
 * RSA signing keys as PKCS#8. Keep the conversion and validation in one module
 * so Relay, the Fleet executor, and the webhook receiver cannot disagree.
 */

const PKCS1_LABEL = 'RSA PRIVATE KEY';
const PKCS8_LABEL = 'PRIVATE KEY';
const RSA_ENCRYPTION_ALGORITHM = new Uint8Array([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
  0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

interface DerElement {
  tag: number;
  bodyStart: number;
  bodyEnd: number;
  next: number;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i]! ^ right[i]!;
  return mismatch === 0;
}

function readDerElement(bytes: Uint8Array, offset: number): DerElement {
  if (offset < 0 || offset + 2 > bytes.length) throw new Error('truncated DER element');
  const tag = bytes[offset]!;
  const lengthByte = bytes[offset + 1]!;
  let length = 0;
  let bodyStart = offset + 2;
  if ((lengthByte & 0x80) === 0) {
    length = lengthByte;
  } else {
    const width = lengthByte & 0x7f;
    if (width === 0 || width > 4 || bodyStart + width > bytes.length) {
      throw new Error('invalid DER length');
    }
    if (bytes[bodyStart] === 0) throw new Error('non-minimal DER length');
    for (let i = 0; i < width; i += 1) length = (length * 256) + bytes[bodyStart + i]!;
    if (length < 0x80) throw new Error('non-minimal DER length');
    bodyStart += width;
  }
  const bodyEnd = bodyStart + length;
  if (!Number.isSafeInteger(bodyEnd) || bodyEnd > bytes.length) throw new Error('truncated DER body');
  return { tag, bodyStart, bodyEnd, next: bodyEnd };
}

function requireTopSequence(bytes: Uint8Array): DerElement {
  const top = readDerElement(bytes, 0);
  if (top.tag !== 0x30 || top.next !== bytes.length) throw new Error('private key is not one DER sequence');
  return top;
}

function requireSmallVersion(bytes: Uint8Array, offset: number, limit: number): DerElement {
  const version = readDerElement(bytes, offset);
  if (version.tag !== 0x02 || version.bodyEnd > limit || version.bodyEnd - version.bodyStart !== 1
      || (bytes[version.bodyStart] !== 0 && bytes[version.bodyStart] !== 1)) {
    throw new Error('private key has an invalid version');
  }
  return version;
}

function validatePkcs1(bytes: Uint8Array): void {
  const top = requireTopSequence(bytes);
  let cursor = requireSmallVersion(bytes, top.bodyStart, top.bodyEnd).next;
  // version + modulus, publicExponent, privateExponent, prime1, prime2,
  // exponent1, exponent2, coefficient. GitHub-generated App keys are the
  // ordinary two-prime (version 0) form.
  for (let i = 0; i < 8; i += 1) {
    const integer = readDerElement(bytes, cursor);
    if (integer.tag !== 0x02 || integer.bodyStart === integer.bodyEnd || integer.bodyEnd > top.bodyEnd) {
      throw new Error('PKCS#1 key has an invalid RSA integer');
    }
    cursor = integer.next;
  }
  if (cursor !== top.bodyEnd || bytes[requireSmallVersion(bytes, top.bodyStart, top.bodyEnd).bodyStart] !== 0) {
    throw new Error('PKCS#1 key is not a supported two-prime RSA key');
  }
}

function validatePkcs8(bytes: Uint8Array): void {
  const top = requireTopSequence(bytes);
  const version = requireSmallVersion(bytes, top.bodyStart, top.bodyEnd);
  if (bytes[version.bodyStart] !== 0) throw new Error('PKCS#8 key has an unsupported version');
  const algorithm = readDerElement(bytes, version.next);
  if (algorithm.tag !== 0x30 || algorithm.bodyEnd > top.bodyEnd
      || !bytesEqual(bytes.slice(version.next, algorithm.next), RSA_ENCRYPTION_ALGORITHM)) {
    throw new Error('PKCS#8 key is not an RSA private key');
  }
  const privateKey = readDerElement(bytes, algorithm.next);
  if (privateKey.tag !== 0x04 || privateKey.bodyStart === privateKey.bodyEnd || privateKey.next !== top.bodyEnd) {
    throw new Error('PKCS#8 key has an invalid private-key payload');
  }
  validatePkcs1(bytes.slice(privateKey.bodyStart, privateKey.bodyEnd));
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes: number[] = [];
  for (let value = length; value > 0; value = Math.floor(value / 256)) bytes.unshift(value & 0xff);
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, body: Uint8Array): Uint8Array {
  const length = derLength(body.length);
  const out = new Uint8Array(1 + length.length + body.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(body, 1 + length.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function decodeBase64(value: string): Uint8Array {
  const compact = value.replace(/\s/g, '');
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error('private key contains invalid base64');
  }
  try {
    return Uint8Array.from(atob(compact), (character) => character.charCodeAt(0));
  } catch {
    throw new Error('private key contains invalid base64');
  }
}

function decodePemInput(input: string): { label: string; der: Uint8Array } {
  let normalized = input.trim();
  if (!normalized.includes('-----BEGIN ') && /^[A-Za-z0-9+/=\s]+$/.test(normalized)) {
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
      .decode(decodeBase64(normalized)).trim();
    normalized = decoded;
  }
  if (normalized.includes('\\n')) normalized = normalized.replace(/\\n/g, '\n').trim();

  const match = normalized.match(/^-----BEGIN ([A-Z0-9 ]+)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END ([A-Z0-9 ]+)-----$/);
  if (!match || match[1] !== match[3] || (match[1] !== PKCS1_LABEL && match[1] !== PKCS8_LABEL)) {
    throw new Error('GitHub App private key must be one unencrypted PKCS#1 or PKCS#8 PEM');
  }
  return { label: match[1]!, der: decodeBase64(match[2]!) };
}

/** Convert a raw, escaped-newline, or base64-wrapped App PEM to PKCS#8 DER. */
export function githubAppPrivateKeyDer(pemKey: string): Uint8Array {
  const decoded = decodePemInput(pemKey);
  if (decoded.label === PKCS8_LABEL) {
    validatePkcs8(decoded.der);
    return decoded.der;
  }

  validatePkcs1(decoded.der);
  return der(0x30, concat(
    new Uint8Array([0x02, 0x01, 0x00]),
    RSA_ENCRYPTION_ALGORITHM,
    der(0x04, decoded.der),
  ));
}

/** Import one validated GitHub App signing key using Workers Web Crypto. */
export async function importGitHubAppSigningKey(pemKey: string): Promise<CryptoKey> {
  const bytes = githubAppPrivateKeyDer(pemKey);
  // Materialize an ordinary ArrayBuffer rather than forwarding the typed
  // array's ArrayBufferLike. Older Workers type bundles reject a possible
  // SharedArrayBuffer even though the parser always allocated local bytes.
  const keyData = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(keyData).set(bytes);
  return crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

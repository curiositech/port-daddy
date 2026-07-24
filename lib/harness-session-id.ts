export const NATIVE_SESSION_ADAPTER_FAMILIES = [
  'claude-code',
  'codex-cli',
  'agy-cli',
  'gemini-cli',
] as const;

export type NativeSessionAdapterFamily = typeof NATIVE_SESSION_ADAPTER_FAMILIES[number];

const NATIVE_SESSION_ADAPTER_SET = new Set<string>(NATIVE_SESSION_ADAPTER_FAMILIES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNativeSessionAdapterFamily(value: string): value is NativeSessionAdapterFamily {
  return NATIVE_SESSION_ADAPTER_SET.has(value);
}

export function normalizeNativeHarnessSessionId(
  adapterFamily: NativeSessionAdapterFamily,
  value: unknown,
): string {
  if (typeof value !== 'string' || value !== value.trim() || !UUID_PATTERN.test(value)) {
    throw new Error(`${adapterFamily} native session ID must be a canonical UUID`);
  }
  return value.toLowerCase();
}

export function nativeHarnessSessionIdError(adapterFamily: string, value: unknown): string | null {
  if (!isNativeSessionAdapterFamily(adapterFamily)) return null;
  try {
    normalizeNativeHarnessSessionId(adapterFamily, value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : `${adapterFamily} native session ID is invalid`;
  }
}

export interface ActorIdOptions {
  fromActorId?: string | null;
  fromSoulClass?: string | null;
}

/**
 * Extracts and normalises `fromActorId` and `fromSoulClass` from an arbitrary options object.
 * Returns `null` for each field when the value is missing, not a string, or an empty string.
 */
export function extractActorIds(options: any): ActorIdOptions {
  const fromActorId =
    typeof options?.fromActorId === "string" && options.fromActorId
      ? options.fromActorId
      : null;
  const fromSoulClass =
    typeof options?.fromSoulClass === "string" && options.fromSoulClass
      ? options.fromSoulClass
      : null;
  return { fromActorId, fromSoulClass };
}

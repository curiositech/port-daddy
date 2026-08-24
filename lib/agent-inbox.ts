import { extractActorIds } from "./utils/actor-id-extractor";

// ... other imports and code ...

export async function send(
  inbox: Inbox,
  payload: any,
  options: any = {}
): Promise<SendResult> {
  // Use the shared extractor instead of duplicated inline logic
  const { fromActorId, fromSoulClass } = extractActorIds(options);

  // existing send implementation now uses `fromActorId` and `fromSoulClass`
  // ... rest of function unchanged ...
}

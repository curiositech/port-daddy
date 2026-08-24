import { extractActorIds } from "./utils/actor-id-extractor";

// ... other imports and code ...

export async function someFunctionThatNeedsActorIds(
  params: any,
  options: any = {}
) {
  const { fromActorId, fromSoulClass } = extractActorIds(options);

  // existing logic that previously duplicated the extraction now uses the variables
  // ... rest of function unchanged ...
}

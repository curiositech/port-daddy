import { LaunchIntent, SpawnSpec, SpawnResult } from './types';
import { setState, get } from './state';

// ... other imports and code ...

export async function launch(intent: LaunchIntent): Promise<{ launch: any; admitted: boolean; refusedReason: string | null; spawn: SpawnResult | null }> {
  // ... existing logic ...
  try {
    intent.onAdmitted?.(admitted);
  } catch (err) {
    // Release reserved resources and mark launch as failed
    setState(admitted.id, 'failed', { errorMessage: (err as Error).message });
    // Return a proper admission failure indication
    return {
      launch: get(admitted.id)!,
      admitted: false,
      refusedReason: (err as Error).message,
      spawn: null
    };
  }

  // Proceed with spawning if admission succeeded
  const spawnResult = await spawner.spawn(spec);
  // ... rest of launch implementation ...
}

// ... rest of file unchanged ...
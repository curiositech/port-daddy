/**
 * withDeadline — bound a promise with a hard timeout WITHOUT leaking the timer.
 *
 * A naive `Promise.race([work, new Promise((_, r) => setTimeout(r, ms))])`
 * leaves the timer armed when `work` wins the race. In a Worker that runs many
 * ship reviews per webhook, those orphaned timers accumulate and keep the
 * event loop pinned for the full deadline after the useful work is done
 * (Copilot review finding on #654). The `finally` here clears the timer on
 * every exit path — resolve, reject, or timeout.
 */
export async function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

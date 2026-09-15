/** Shared logical state: a blocking control hold, never a provider retry/verdict. */
export const FLEET_WAITING_CONTROL = 'waiting_for_control' as const;
export const FLEET_WAITING_CONTROL_COPY = 'Waiting for control — no automatic retry is scheduled. An operator must authorize redelivery after control is restored. If the pause revision changed, request a new review delivery instead.';

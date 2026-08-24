const cronEnv = (over = {}) => {
  const locks = new Map();
  return {
    env: makeEnv({
      DB: memoryD1().db,
      ...over,
      STEWARD: {
        idFromName: (name) => ({ name }),
        get: (id) => {
          const lock = locks.get(id.name) || new Mutex();
          locks.set(id.name, lock);
          return { fetch: (r) => lock.runExclusive(() => {
            // existing DO initialization logic
          }) };
        }
      } as any
    }),
  };
};
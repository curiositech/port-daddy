it('does not offer the card when stdin is not a TTY (pipe)', () => {
  const original = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
  try {
    expect(shouldShowSugarParleyExperience({})).toBe(false);
  } finally {
    Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true });
  }
});
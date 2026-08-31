describe('canRunInteractiveOrientation', () => {
  test('requires a controlling terminal and rejects CI and explicit non-interactive env', () => {
    expect(canRunInteractiveOrientation({}, () => true)).toBe(true);
    expect(canRunInteractiveOrientation({ CI: '1' }, () => true)).toBe(false);
    expect(canRunInteractiveOrientation({ PORT_DADDY_NON_INTERACTIVE: '1' }, () => true)).toBe(false);
    expect(canRunInteractiveOrientation({}, () => false)).toBe(false);
  });

  test('ignores color flags as interaction evidence', () => {
    expect(canRunInteractiveOrientation({ FORCE_COLOR: '1' }, () => false)).toBe(false);
    expect(canRunInteractiveOrientation({ NO_COLOR: '1' }, () => true)).toBe(true);
    expect(canRunInteractiveOrientation({ FORCE_COLOR: '0', NO_COLOR: '1' }, () => true)).toBe(true);
  });

  test('a terminal plus CI cannot force interactive pacing', () => {
    expect(canRunInteractiveOrientation({ CI: 'true', PORT_DADDY_NON_INTERACTIVE: '0' }, () => true)).toBe(false);
    expect(canRunInteractiveOrientation({ CI: '0' }, () => true)).toBe(true);
  });
});
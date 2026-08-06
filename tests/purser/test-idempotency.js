const { execSync } = require('child_process');

describe('Idempotency', () => {
  test('Should produce same output on repeated runs', () => {
    const output1 = execSync('sh scripts/build-whitepapers.sh').toString();
    const output2 = execSync('sh scripts/build-whitepapers.sh').toString();
    expect(output1).toBe(output2);
  });
});
const { execSync } = require('child_process');

describe('Concurrency', () => {
  test('Should handle concurrent builds', () => {
    const promises = [0, 1].map(() => {
      return new Promise((resolve, reject) => {
        execSync('sh scripts/build-whitepapers.sh', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
    return Promise.all(promises);
  });
});
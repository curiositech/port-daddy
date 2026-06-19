// Test setup - runs before all tests
import { unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use a separate test database
process.env.PORT_DADDY_DB = join(__dirname, '../port-registry-test.db');
process.env.PORT_DADDY_PORT = 9877; // Different port for tests

// Clean up test database before tests
beforeAll(() => {
  try {
    unlinkSync(process.env.PORT_DADDY_DB);
    unlinkSync(process.env.PORT_DADDY_DB + '-shm');
    unlinkSync(process.env.PORT_DADDY_DB + '-wal');
  } catch (err) {
    // Files may not exist, that's okay
  }
});

// Clean up after all tests
afterAll(() => {
  try {
    unlinkSync(process.env.PORT_DADDY_DB);
    unlinkSync(process.env.PORT_DADDY_DB + '-shm');
    unlinkSync(process.env.PORT_DADDY_DB + '-wal');
  } catch (err) {
    // Ignore cleanup errors
  }
});

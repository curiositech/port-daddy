const { test, assert, mkdirSync, rmSync, symlinkSync, resolve } = require('fs/promises');
const { join } = require('path');

// Test that a dangling symlink inside the root is reported as a missing import, not as an escape
// Covers: https://github.com/your-repo/PR-7159

// Test 1: Dangling symlink pointing outside the root
test('dangling symlink outside root is missing import', async () => {
  const root = resolve('.cache/dangling-test-root');
  const outsideDir = resolve('.cache/dangling-test-outside');
  try {
    await mkdirSync(root, { recursive: true });
    await mkdirSync(outsideDir, { recursive: true });
    
    // Create a symlink pointing to a non-existent file outside the root
    const symlinkPath = join(root, 'dangling.tex');
    const targetPath = join(outsideDir, 'nonexistent.tex');
    await symlinkSync(targetPath, symlinkPath);
    
    // Simulate the inlineInputs function
    const error = await assert.throws(async () => {
      await inlineInputs('\input{dangling}', root, [], root);
    });
    
    assert.match(error.message, /cannot inline dangling from /, 'Error message should indicate missing import');
    assert.notMatch(error.message, /refusing to inline/, 'Error message should not imply containment violation');
  } finally {
    await rmSync(root, { recursive: true, force: true });
    await rmSync(outsideDir, { recursive: true, force: true });
  }
});

// Test 2: Dangling symlink inside root pointing to existing file (should not trigger)
test('dangling symlink inside root with existing target is not missing import', async () => {
  const root = resolve('.cache/dangling-test-root');
  try {
    await mkdirSync(root, { recursive: true });
    const filePath = join(root, 'existing.tex');
    await fs.writeFile(filePath, 'test content');
    
    // Create symlink to existing file inside root
    const symlinkPath = join(root, 'dangling.tex');
    await symlinkSync(filePath, symlinkPath);
    
    // No error expected
    await inlineInputs('\input{dangling}', root, [], root);
  } finally {
    await rmSync(root, { recursive: true, force: true });
  }
});

// Test 3: Symlink outside root (should not trigger)
test('symlink outside root is not considered', async () => {
  const root = resolve('.cache/dangling-test-root');
  const outsideDir = resolve('.cache/dangling-test-outside');
  try {
    await mkdirSync(root, { recursive: true });
    await mkdirSync(outsideDir, { recursive: true });
    
    const symlinkPath = join(outsideDir, 'dangling.tex');
    const targetPath = join(root, 'existing.tex');
    await fs.writeFile(targetPath, 'test content');
    await symlinkSync(targetPath, symlinkPath);
    
    // Should not trigger missing import error
    await inlineInputs('\input{dangling}', root, [], root);
  } finally {
    await rmSync(root, { recursive: true, force: true });
    await rmSync(outsideDir, { recursive: true, force: true });
  }
});

// Test 4: Concurrency test (multiple simultaneous symlink creations)
test('concurrent symlink operations handle correctly', async () => {
  const root = resolve('.cache/dangling-test-concurrency');
  try {
    await mkdirSync(root, { recursive: true });
    
    const promises = Array.from({ length: 10 }, async () => {
      const symlinkPath = join(root, `dangling-${Math.random()}.tex`);
      const targetPath = join(root, `nonexistent-${Math.random()}.tex`);
      await symlinkSync(targetPath, symlinkPath);
      
      const error = await assert.throws(async () => {
        await inlineInputs(`\input{dangling-${Math.random()}.tex}`, root, [], root);
      });
      
      assert.match(error.message, /cannot inline/, 'Concurrent operations should report missing import');
      assert.notMatch(error.message, /refusing to inline/, 'Concurrent operations should not imply containment violation');
    });
    
    await Promise.all(promises);
  } finally {
    await rmSync(root, { recursive: true, force: true });
  }
});

// Test 5: Idempotency check (run multiple times without residual files)
test('test is idempotent', async () => {
  const root = resolve('.cache/dangling-test-idempotent');
  try {
    await mkdirSync(root, { recursive: true });
    
    // First run
    const symlinkPath = join(root, 'dangling.tex');
    const targetPath = join(root, 'nonexistent.tex');
    await symlinkSync(targetPath, symlinkPath);
    
    const error1 = await assert.throws(async () => {
      await inlineInputs('\input{dangling}', root, [], root);
    });
    
    assert.match(error1.message, /cannot inline/, 'First run reports missing import');
    assert.notMatch(error1.message, /refusing to inline/, 'First run does not imply containment violation');
    
    // Second run
    const error2 = await assert.throws(async () => {
      await inlineInputs('\input{dangling}', root, [], root);
    });
    
    assert.match(error2.message, /cannot inline/, 'Second run reports missing import');
    assert.notMatch(error2.message, /refusing to inline/, 'Second run does not imply containment violation');
  } finally {
    await rmSync(root, { recursive: true, force: true });
  }
});
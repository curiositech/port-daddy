/**
 * Unit Tests for Maritime Vocabulary Harmonization (Phase 10)
 *
 * Tests that maritime terms are paired with standard developer terms
 * so output is readable for everyone.
 */

import { describe, it, expect } from '@jest/globals';
import { status } from '../../lib/maritime.js';

describe('Maritime Labels', () => {

  describe('status() output', () => {
    it('should include the paired label in output', () => {
      const output = status('success', 'Port claimed');
      // Should contain both the maritime label AND the message
      expect(output).toContain('ROGER');
      expect(output).toContain('Done');
      expect(output).toContain('Port claimed');
    });

    it('should include the paired label for errors', () => {
      const output = status('error', 'Lock failed');
      expect(output).toContain('NEGATIVE');
      expect(output).toContain('Error');
      expect(output).toContain('Lock failed');
    });

    it('should include the paired label for help/mayday', () => {
      const output = status('help', 'System down');
      expect(output).toContain('MAYDAY');
      expect(output).toContain('Critical');
      expect(output).toContain('System down');
    });
  });
});

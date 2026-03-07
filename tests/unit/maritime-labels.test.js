/**
 * Unit Tests for Maritime Vocabulary Harmonization (Phase 10)
 *
 * Tests that maritime terms are paired with standard developer terms
 * so output is readable for everyone.
 */

import { describe, it, expect } from '@jest/globals';
import { status, STATUS_LABELS } from '../../lib/maritime.js';

describe('Maritime Labels', () => {

  describe('STATUS_LABELS pairing', () => {
    it('should pair success with ROGER', () => {
      expect(STATUS_LABELS.success).toMatch(/ROGER/);
      expect(STATUS_LABELS.success).toMatch(/Done/);
    });

    it('should pair error with NEGATIVE', () => {
      expect(STATUS_LABELS.error).toMatch(/NEGATIVE/);
      expect(STATUS_LABELS.error).toMatch(/Error/);
    });

    it('should pair ready with KILO', () => {
      expect(STATUS_LABELS.ready).toMatch(/KILO/);
      expect(STATUS_LABELS.ready).toMatch(/Ready/);
    });

    it('should pair warning with HAIL', () => {
      expect(STATUS_LABELS.warning).toMatch(/HAIL/);
      expect(STATUS_LABELS.warning).toMatch(/Warning/);
    });

    it('should pair help with MAYDAY', () => {
      expect(STATUS_LABELS.help).toMatch(/MAYDAY/);
      expect(STATUS_LABELS.help).toMatch(/Critical/);
    });

    it('should pair stop with LIMA', () => {
      expect(STATUS_LABELS.stop).toMatch(/LIMA/);
      expect(STATUS_LABELS.stop).toMatch(/Blocked/);
    });

    it('should have all 6 status types defined', () => {
      const types = ['success', 'error', 'ready', 'warning', 'help', 'stop'];
      for (const type of types) {
        expect(STATUS_LABELS[type]).toBeDefined();
        // Each label should have format "MARITIME -- Standard"
        expect(STATUS_LABELS[type]).toMatch(/.+ — .+/);
      }
    });
  });

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

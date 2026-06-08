import { describe, expect, it } from 'vitest';
import { colors } from './color';
import { spacing } from './spacing';
import { tokens } from './index';

describe('color tokens', () => {
  it('every color is a valid hex value', () => {
    for (const [name, value] of Object.entries(colors)) {
      expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('exposes the busyBlock role used for sensitive-public redaction', () => {
    // Privacy redaction (a mandatory high-coverage area) renders busy events as a
    // neutral gray block — guard that the token it depends on exists.
    expect(colors.busyBlock).toBe(colors.gray300);
  });
});

describe('spacing scale', () => {
  it('is a strictly increasing 4px-based scale starting at 0', () => {
    const values = Object.values(spacing);
    expect(values[0]).toBe(0);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
      expect(values[i]! % 4).toBe(0);
    }
  });
});

describe('tokens aggregate', () => {
  it('bundles all four token groups', () => {
    expect(Object.keys(tokens).sort()).toEqual(['colors', 'radius', 'spacing', 'typography']);
  });
});

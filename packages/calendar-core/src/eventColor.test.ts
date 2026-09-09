import { describe, expect, it } from 'vitest';
import { EVENT_PALETTE, resolveEventColor } from './eventColor';

const BUSY = '#8b8d98';

function occurrence(overrides: Partial<Parameters<typeof resolveEventColor>[0]> = {}) {
  return { visibility: 'private', colorLabel: null as string | null, ...overrides };
}

describe('resolveEventColor', () => {
  it('never returns a value that is not a colour, whatever colorLabel holds', () => {
    // `colorLabel` is a user-writable free-text column. React Native given a
    // non-colour renders transparent and logs a warning instead of throwing,
    // so a bad value is invisible in tests and shows up as a missing event.
    for (const bad of ['__birthday__', 'red', 'rgb(1,2,3)', '#fff', '', '   ', 'drop table']) {
      expect(resolveEventColor(occurrence({ colorLabel: bad }), 0, BUSY)).toMatch(
        /^#[0-9a-fA-F]{6}$/,
      );
    }
  });

  it('honours a valid six-digit hex colorLabel', () => {
    expect(resolveEventColor(occurrence({ colorLabel: '#30a46c' }), 0, BUSY)).toBe('#30a46c');
  });

  it('shows sensitive-public occurrences as the busy colour, ignoring their colorLabel', () => {
    expect(
      resolveEventColor(occurrence({ visibility: 'sensitive_public', colorLabel: '#30a46c' }), 0, BUSY),
    ).toBe(BUSY);
  });

  it('cycles the palette by column so adjacent events differ', () => {
    const first = resolveEventColor(occurrence(), 0, BUSY);
    const second = resolveEventColor(occurrence(), 1, BUSY);
    expect(first).not.toBe(second);
  });

  it('wraps the palette rather than returning undefined past its end', () => {
    expect(resolveEventColor(occurrence(), EVENT_PALETTE.length, BUSY)).toBe(EVENT_PALETTE[0]);
    expect(resolveEventColor(occurrence(), EVENT_PALETTE.length * 3 + 2, BUSY)).toBe(
      EVENT_PALETTE[2],
    );
  });
});

/**
 * The colour rule for an occurrence bar — one implementation, both platforms.
 *
 * This lives here rather than in either app because it is a rule, not markup
 * (AD-3): mobile and web each draw their own bar, but neither gets to decide
 * independently what colour it is. Before this existed, `colorLabel` was
 * returned verbatim, so a row carrying the old `'__birthday__'` sentinel — or
 * any other non-colour a client wrote — reached a native colour prop.
 *
 * The busy colour is injected rather than imported: this package is
 * deliberately zero-dependency, so it cannot reach for `@planpal/ui`'s theme.
 */

/** Fallback palette, cycled by column index so adjacent bars differ. */
export const EVENT_PALETTE = [
  '#5b6cff',
  '#30a46c',
  '#e5484d',
  '#ffb224',
  '#6e56cf',
  '#12a594',
] as const;

/** Six-digit hex is the only form every platform's colour prop accepts here. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface ColorableOccurrence {
  visibility: string;
  colorLabel?: string | null;
}

/**
 * Resolve the bar colour.
 *
 * `colorLabel` is validated by SHAPE rather than checked against known-bad
 * values. Special-casing the `'__birthday__'` sentinel would leave every other
 * bad string, and the sentinel is only notable because we happened to ship it —
 * `PATCH /events/:id` accepts any string in that column.
 */
export function resolveEventColor(
  occurrence: ColorableOccurrence,
  columnIndex: number,
  busyColor: string,
): string {
  if (occurrence.visibility === 'sensitive_public') return busyColor;

  const label = occurrence.colorLabel;
  if (label !== null && label !== undefined && HEX_COLOR.test(label.trim())) return label.trim();

  return EVENT_PALETTE[columnIndex % EVENT_PALETTE.length]!;
}

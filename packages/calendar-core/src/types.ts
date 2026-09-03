/** Shared shapes for the calendar maths. */

export interface CalendarDay {
  /** YYYY-MM-DD */
  date: string;
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  /** True when this cell is padding from an adjacent month. */
  isOutsideMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

/**
 * The minimum an occurrence must provide to be laid out.
 *
 * Deliberately structural rather than importing `EventOccurrence` from
 * `@planpal/types`. AD-2 specifies this package has zero dependencies, and a
 * type-only import would still make it one in the workspace graph. Anything
 * carrying these three fields — including the generated `EventOccurrence` —
 * satisfies it, so callers keep full type safety at the call site while this
 * package stays free-standing.
 */
export interface DayOccurrence {
  /** Local wall-clock start, `YYYY-MM-DDTHH:mm[:ss]`. */
  localStart: string;
  /** Local wall-clock end, `YYYY-MM-DDTHH:mm[:ss]`. */
  localEnd: string;
  /**
   * Variable-schedule placeholders have no concrete times. They are excluded
   * from the timed layout and surfaced separately by the view.
   */
  isVariableSchedule?: boolean;
}

/**
 * An occurrence placed in the day grid.
 *
 * Positions are FRACTIONS of a 24-hour day, not pixels. Mobile and web use
 * different hour heights, and returning pixels would either force one platform
 * to adopt the other's scale or push the maths back into the views — which is
 * exactly what AD-3 exists to prevent.
 */
export interface PositionedOccurrence<T extends DayOccurrence = DayOccurrence> {
  occurrence: T;
  /** 0 at midnight, 0.5 at noon. */
  topFraction: number;
  /** Duration as a fraction of 24h. A 30-minute event is 1/48. */
  heightFraction: number;
  /** 0-based column within its overlap cluster. */
  column: number;
  /** Columns in this occurrence's cluster; width is 1 / columnCount. */
  columnCount: number;
}

import type { Http } from '../http';

export interface ExportResource {
  /**
   * Returns the `.ics` body as a **string**, not a `Blob` (a correction to §5).
   *
   * React Native's `fetch` has partial Blob support, so a Blob here would work
   * on web and fail on a phone — and the phone is the platform this feature
   * exists for. A caller that wants a file writes the string.
   */
  ical(): Promise<string>;
}

export function createExportResource(http: Http): ExportResource {
  return {
    ical() {
      return http.text('export/ical');
    },
  };
}

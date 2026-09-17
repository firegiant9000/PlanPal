import type { Feedback, FeedbackCreate } from '@planpal/types';
import type { Http } from '../http';

export interface FeedbackResource {
  /**
   * Submit in-app feedback. Returns the recorded `Feedback` (a correction to
   * §5's old default — see `DevicesResource.register`'s doc comment for the
   * same reasoning: a caller that gets nothing back cannot confirm what was
   * actually recorded).
   *
   * Rate-limited to 20 submissions per user per 24 hours (`PlanPalApiError`
   * with code `RATE_LIMITED` on the 21st).
   */
  create(input: FeedbackCreate): Promise<Feedback>;
}

export function createFeedbackResource(http: Http): FeedbackResource {
  return {
    create(input) {
      return http.json<Feedback>('feedback', { method: 'POST', body: input });
    },
  };
}

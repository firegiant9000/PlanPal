import type { components } from '@planpal/types';
import type { Http } from '../http';

/** `status` plus the deployed commit SHA (E3). */
export type Health = components['schemas']['Health'];

/**
 * A method §5 omitted. T29's offline indicator needs something cheap to ask
 * before deciding it is offline, and `/healthz` is `security: []` so it works
 * with no session — which is exactly the state an offline app may be in.
 */
export function createHealthResource(http: Http): () => Promise<Health> {
  return () => http.json<Health>('healthz');
}

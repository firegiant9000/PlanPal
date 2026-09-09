'use client';

import { useEffect, type ReactNode } from 'react';
import { initObservability } from '../lib/observability';
import { AuthGuard } from '../components/AuthGuard';

/** Client-side bootstrap: initializes Sentry + PostHog once on mount. */
export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    initObservability();
  }, []);

  return <AuthGuard>{children}</AuthGuard>;
}

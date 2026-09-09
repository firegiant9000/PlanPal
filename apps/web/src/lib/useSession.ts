'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@planpal/api-client';
import { getPlanPalClient } from './planpalClient';

export interface SessionState {
  session: Session | null;
  /**
   * True until supabase-js has read the stored session back out of
   * localStorage. Brief on web, but not zero — and a guard that treats
   * "not loaded yet" as "signed out" bounces a signed-in user to /sign-in on
   * every hard refresh.
   */
  loading: boolean;
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });

  useEffect(() => {
    let active = true;
    const client = getPlanPalClient();

    void client.auth.getSession().then((session) => {
      if (active) setState({ session, loading: false });
    });

    const unsubscribe = client.auth.onAuthStateChange((session) => {
      if (active) setState({ session, loading: false });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}

import { useEffect, useState } from 'react';
import type { Session } from '@planpal/api-client';
import { planpalClient } from '../planpalClient';

export interface SessionState {
  session: Session | null;
  /**
   * True until the stored session has been read back from the Keychain.
   *
   * This is the whole reason the hook has three states rather than two.
   * Restoring from `expo-secure-store` is asynchronous, so for the first frames
   * after launch `session` is null but the user is not signed out. A guard that
   * treats those two as the same thing redirects to sign-in on every cold
   * start — which is precisely the failure T7's definition of done rules out.
   */
  loading: boolean;
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });

  useEffect(() => {
    let active = true;

    void planpalClient.auth.getSession().then((session) => {
      if (active) setState({ session, loading: false });
    });

    // Covers sign-in, sign-out, and the silent token refresh.
    const unsubscribe = planpalClient.auth.onAuthStateChange((session) => {
      if (active) setState({ session, loading: false });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}

'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '../lib/useSession';

/**
 * Client-side route guard.
 *
 * Deliberately NOT `middleware.ts`. AD-9 has web keep the session in
 * localStorage via supabase-js's own adapter, and middleware runs on the edge
 * with only cookies to look at — it cannot see that session, so it would either
 * wave everyone through or lock everyone out. Moving the session into a cookie
 * to make middleware work is a bigger architectural change than T7, and it is
 * not what AD-9 says.
 *
 * The honest consequence, which belongs in the PR rather than in a comment
 * nobody reads: this hides UI, it does not protect data. Authorisation is
 * enforced by RLS and by the Edge Functions, server-side, exactly as §15
 * requires. A user who disables JavaScript sees an empty shell, not somebody
 * else's calendar.
 */
const PUBLIC_PATHS = ['/sign-in', '/sign-up', '/forgot-password', '/auth/callback'];

export function AuthGuard({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (loading) return;
    if (!session && !isPublic) {
      router.replace('/sign-in');
    } else if (session && isPublic && !pathname.startsWith('/auth/callback')) {
      router.replace('/');
    }
  }, [loading, session, isPublic, pathname, router]);

  // Render nothing while restoring, and nothing on a route the user is about
  // to be redirected off. Rendering children first would flash the calendar
  // to a signed-out visitor.
  if (loading) return null;
  if (!session && !isPublic) return null;

  return <>{children}</>;
}

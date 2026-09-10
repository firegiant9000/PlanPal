import type { ReactNode } from 'react';
import { theme } from '@planpal/ui';
import { Providers } from './providers';

export const metadata = {
  title: 'PlanPal',
  description: 'Calendar app with AI screenshot import and one-way social sharing.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning is scoped to this element's own attributes, and
    // is here for browser extensions that inject a class onto <html> before
    // React hydrates (an `idc0_343` class was the observed case). The server
    // renders no className at all, so any difference here comes from outside
    // the app. It does NOT suppress mismatches in the tree below.
    <html lang="en" suppressHydrationWarning>
      <body
        style={{
          margin: 0,
          backgroundColor: theme.colors.bg,
          color: theme.colors.textPrimary,
          fontFamily: theme.typography.fontFamily.sans,
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

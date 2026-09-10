import type { ReactNode } from 'react';
import { theme } from '@planpal/ui';
import { Providers } from './providers';

export const metadata = {
  title: 'PlanPal',
  description: 'Calendar app with AI screenshot import and one-way social sharing.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning is scoped to a single element's own attributes,
    // which is why both <html> and <body> carry it: browser extensions inject
    // into each before React hydrates. Observed cases were an `idc0_343` class
    // on <html>, and Grammarly's `data-gr-ext-installed` /
    // `data-new-gr-c-s-check-loaded` on <body>. The server renders neither, so
    // any difference on these two elements comes from outside the app. This
    // does NOT suppress mismatches anywhere in the tree below.
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
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

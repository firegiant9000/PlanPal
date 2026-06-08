import type { ReactNode } from 'react';
import { theme } from '@planpal/ui';
import { Providers } from './providers';

export const metadata = {
  title: 'PlanPal',
  description: 'Calendar app with AI screenshot import and one-way social sharing.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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

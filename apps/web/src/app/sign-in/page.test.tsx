import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignInPage from './page';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const signInWithPassword = vi.fn();
vi.mock('../../lib/planpalClient', () => ({
  getPlanPalClient: () => ({ auth: { signInWithPassword } }),
}));

afterEach(cleanup);

describe('sign-in demo affordance', () => {
  beforeEach(() => {
    replace.mockReset();
    signInWithPassword.mockReset();
    signInWithPassword.mockResolvedValue({ access_token: 'a' });
  });

  it('signs in with the published demo credentials and lands on the calendar', async () => {
    render(<SignInPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Try the demo' }));

    expect(signInWithPassword).toHaveBeenCalledWith('demo@planpal.app', 'planpal-demo');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('surfaces a failure instead of hanging', async () => {
    signInWithPassword.mockRejectedValue(new Error('Invalid login credentials'));
    render(<SignInPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Try the demo' }));

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not require the email and password fields to be filled', () => {
    render(<SignInPage />);
    expect(screen.getByRole('button', { name: 'Try the demo' })).toBeEnabled();
  });
});

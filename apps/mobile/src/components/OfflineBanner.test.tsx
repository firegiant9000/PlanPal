import { render } from '@testing-library/react-native';
import { OfflineBanner } from './OfflineBanner';

describe('OfflineBanner', () => {
  it('renders the cached fetchedAt as a last-updated time', async () => {
    const { getByText } = await render(
      <OfflineBanner fetchedAt="2026-09-08T12:34:00.000Z" now={new Date('2026-09-08T12:39:00Z')} />,
    );

    // Relative, not absolute: "5 minutes ago" answers the question the user
    // actually has (is this stale?) without making them do date arithmetic.
    expect(getByText(/Offline/)).toBeTruthy();
    expect(getByText(/5 minutes ago/)).toBeTruthy();
  });

  it('says so plainly when there is no cached timestamp', async () => {
    // A banner that renders an empty "last updated " is worse than one that
    // admits it does not know.
    const { getByText, queryByText } = await render(<OfflineBanner fetchedAt={null} />);

    expect(getByText(/Offline/)).toBeTruthy();
    expect(queryByText(/ago/)).toBeNull();
  });

  it('reads as just now for a very recent fetch', async () => {
    const { getByText } = await render(
      <OfflineBanner fetchedAt="2026-09-08T12:39:30.000Z" now={new Date('2026-09-08T12:39:45Z')} />,
    );

    expect(getByText(/just now/i)).toBeTruthy();
  });

  it('falls back to hours and days rather than showing hundreds of minutes', async () => {
    const { getByText } = await render(
      <OfflineBanner fetchedAt="2026-09-06T12:00:00.000Z" now={new Date('2026-09-08T12:00:00Z')} />,
    );

    expect(getByText(/2 days ago/)).toBeTruthy();
  });
});

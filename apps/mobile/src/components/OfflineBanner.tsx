import { StyleSheet, View } from 'react-native';
import { theme } from '@planpal/ui';
import { Text } from './Text';

/**
 * Shown when the calendar is being served from cache (T29).
 *
 * `fetchedAt` comes from `occurrences.rangeDetailed`, which reports the OLDEST
 * timestamp among the months on screen — the honest claim, since some part of
 * the window is at least that stale.
 */
interface OfflineBannerProps {
  /** ISO 8601, or null when nothing cached can date the view. */
  fetchedAt: string | null;
  /** Injectable clock, so the relative label is testable. */
  now?: Date;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Relative, not absolute: "5 minutes ago" answers the question the user
 * actually has — is this stale? — without making them do date arithmetic
 * against a timestamp in a timezone they may not be in.
 */
export function relativeAge(fetchedAt: string, now: Date): string {
  const elapsed = now.getTime() - new Date(fetchedAt).getTime();
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(elapsed / DAY);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function OfflineBanner({ fetchedAt, now }: OfflineBannerProps) {
  const age = fetchedAt === null ? null : relativeAge(fetchedAt, now ?? new Date());

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text color="textPrimary" size="sm" weight="semibold">
        Offline
      </Text>
      <Text color="textSecondary" size="sm">
        {/* No timestamp is stated as such rather than rendered as an empty
            "last updated ", which would look like a bug. */}
        {age === null ? 'Showing the last calendar loaded.' : `Last updated ${age}.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: theme.colors.warning,
    gap: 2,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
});

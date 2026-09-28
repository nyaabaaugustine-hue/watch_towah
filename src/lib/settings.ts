/**
 * Bounds and option lists for the settings screen.
 *
 * The floors are not arbitrary. `activeIntervalSeconds` is how often the app
 * talks to the server while an incident is live, so it is clamped at 5s to keep
 * it useful; `backgroundIntervalSeconds` is clamped at 30s because anything
 * faster on a metered Ghanaian connection costs real money for no safety gain
 * when nobody is in danger. Retention is capped at a year so a typo cannot turn
 * the location history into permanent storage.
 */

export const MIN_BACKGROUND_INTERVAL_SECONDS = 30;
export const MAX_BACKGROUND_INTERVAL_SECONDS = 600;
export const MIN_ACTIVE_INTERVAL_SECONDS = 5;
export const MAX_ACTIVE_INTERVAL_SECONDS = 120;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 365;

/** Background cadence. Sparse enough to be honest about cost. */
export const backgroundIntervalOptions = [30, 60, 120, 300, 600] as const;

/** Live cadence. Tight, because an incident is when accuracy actually matters. */
export const activeIntervalOptions = [5, 10, 15, 30, 60] as const;

export const retentionOptions = [1, 7, 14, 30, 90, 365] as const;

const isListed = <T extends number>(options: readonly T[], value: number): boolean =>
  (options as readonly number[]).includes(value);

/**
 * Snap an arbitrary stored value to the nearest offered option.
 *
 * Settings are written by an older version of the app and by direct database
 * edits, so a stored interval need not be one this screen offers. Rendering a
 * `<select>` with a `value` matching no `<option>` silently shows the first
 * option instead, which would mean the screen lies about the saved state until
 * the user touches something. Choosing the nearest value instead keeps the
 * displayed number and the stored number close without inventing a false exact
 * match.
 */
export const nearestOption = <T extends number>(options: readonly T[], value: number): T => {
  if (isListed(options, value)) {
    return value as T;
  }
  return options.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best,
  );
};

export const describeBackgroundInterval = (seconds: number): string => {
  if (seconds < 60) {
    return `Every ${seconds} seconds while Watchtower is open`;
  }
  const minutes = Math.round(seconds / 60);
  return `Every ${minutes} ${minutes === 1 ? "minute" : "minutes"} while Watchtower is open`;
};

export const describeActiveInterval = (seconds: number): string => {
  const secondsLabel = `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  return `Every ${secondsLabel} while an alert is live`;
};

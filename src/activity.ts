export const DEFAULT_MAX_AGE = "7d";

const units = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Positive, fixed-length durations. Null and "all" disable the cutoff. */
export function parseMaxAge(value: unknown): number | null {
  if (value === null || value === "all") return null;
  if (typeof value !== "string") {
    throw new Error('maxAge must be a duration such as "7d" or "36h", or null for all sessions.');
  }
  const match = /^(\d+(?:\.\d+)?)(m|h|d|w)$/.exec(value.trim());
  if (!match) throw new Error('Use a positive duration with m, h, d, or w (for example "7d"), or "all".');
  const unit = match[2] as keyof typeof units;
  const milliseconds = Number(match[1]) * units[unit];
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > 8_640_000_000_000_000) {
    throw new Error("Duration must be positive and representable as whole milliseconds within the date range.");
  }
  return milliseconds;
}

export function activityCutoff(maxAge: unknown, now = Date.now()): number | null {
  const milliseconds = parseMaxAge(maxAge);
  return milliseconds === null ? null : now - milliseconds;
}

/** Keep Pi's incoming order and session objects, including the boundary instant. */
export function filterByActivity<T extends { modified: Date }>(sessions: T[], cutoff: number | null): T[] {
  return cutoff === null ? sessions : sessions.filter((session) => session.modified.getTime() >= cutoff);
}

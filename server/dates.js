// Days written YYYY-MM-DD, checked as real calendar days (2026-02-31 and 2026-00-99 aren't), used everywhere a day is
// accepted so one check covers them all.
export function isDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

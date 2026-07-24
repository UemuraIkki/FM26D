/**
 * Simulation calendar (requirement 3.1: daily tick).
 *
 * Dates are plain `{ year, month, day }` values (no timezones — the sim world
 * has one clock). Stored/compared via ISO strings ("2026-08-15").
 */

export interface SimDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function toIso(d: SimDate): string {
  const m = String(d.month).padStart(2, "0");
  const day = String(d.day).padStart(2, "0");
  return `${d.year}-${m}-${day}`;
}

export function fromIso(iso: string): SimDate {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`invalid date: ${iso}`);
  return { year: y, month: m, day: d };
}

function toUtc(d: SimDate): number {
  return Date.UTC(d.year, d.month - 1, d.day);
}

function fromUtc(ms: number): SimDate {
  const dt = new Date(ms);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

export function addDays(d: SimDate, days: number): SimDate {
  return fromUtc(toUtc(d) + days * 86_400_000);
}

export function daysBetween(a: SimDate, b: SimDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function compareDates(a: SimDate, b: SimDate): number {
  return toUtc(a) - toUtc(b);
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(d: SimDate): number {
  return new Date(toUtc(d)).getUTCDay();
}

/** First occurrence of `weekday` on or after `d`. */
export function nextWeekday(d: SimDate, weekday: number): SimDate {
  const diff = (weekday - dayOfWeek(d) + 7) % 7;
  return addDays(d, diff);
}

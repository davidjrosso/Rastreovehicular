export type CasePeriod = {
  starts_at?: string | Date | null;
  ends_at?: string | Date | null;
};
export function periodBounds(c: CasePeriod) {
  return {
    from: c.starts_at ? new Date(c.starts_at).getTime() : -Infinity,
    to: c.ends_at ? new Date(c.ends_at).getTime() : Infinity,
  };
}
export function withinCasePeriod(c: CasePeriod, from: string, to = from) {
  const bounds = periodBounds(c);
  return Date.parse(from) >= bounds.from && Date.parse(to) <= bounds.to;
}
export function suggestedWindow(c: CasePeriod, hours = 24, now = Date.now()) {
  const bounds = periodBounds(c),
    end = Math.min(bounds.to, now);
  const start =
    c.ends_at && c.starts_at
      ? bounds.from
      : Math.max(
          Number.isFinite(bounds.from) ? bounds.from : -Infinity,
          end - hours * 3600000,
        );
  return {
    from: new Date(start).toISOString(),
    to: new Date(Math.min(end, start + hours * 3600000)).toISOString(),
  };
}

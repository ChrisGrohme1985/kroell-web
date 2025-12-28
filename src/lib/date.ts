export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
export function startOfTomorrow(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}
export function startOfDayPlus(days: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + days);
  return d;
}

export function fmtTime(d: Date) {
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(d);
}
export function fmtDate(d: Date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d);
}
export function fmtDateTime(d: Date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

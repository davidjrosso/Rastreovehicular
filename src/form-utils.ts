const normalized = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .trim();

export function matchesCamera(
  camera: { number: number; name: string },
  query: string,
) {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const haystack = normalized(`${camera.number} ${camera.name}`);
  return terms.every((term) =>
    /^\d+$/.test(term)
      ? String(camera.number).includes(String(Number(term))) ||
        haystack.includes(term)
      : haystack.includes(term),
  );
}

export function normalizeClock(clock: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(clock)) return "";
  return clock.length === 5 ? `${clock}:00` : clock;
}

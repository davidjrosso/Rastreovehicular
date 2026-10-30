export type RoutePoint = [number, number];
export const lineStyles = {
  solid: "Continua",
  dashed: "Discontinua",
  dotted: "Punteada",
  hidden: "Sin línea",
};
export type LineStyle = keyof typeof lineStyles;
export const captureCenter = (entry: any): RoutePoint => {
  const cams = entry.payload.cameras;
  return [
    cams.reduce((n: number, c: any) => n + c.lon, 0) / cams.length,
    cams.reduce((n: number, c: any) => n + c.lat, 0) / cams.length,
  ];
};
export function routeLength(points: RoutePoint[]) {
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const lat = ((a[1] + b[1]) * Math.PI) / 360;
    distance += Math.hypot(
      (b[0] - a[0]) * 111320 * Math.cos(lat),
      (b[1] - a[1]) * 110950,
    );
  }
  return distance;
}
export function nearestSegment(points: RoutePoint[], p: RoutePoint) {
  let best = Infinity,
    index = 1;
  const sx = Math.cos((p[1] * Math.PI) / 180);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = (b[0] - a[0]) * sx,
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p[0] - a[0]) * sx * dx + (p[1] - a[1]) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const d = Math.hypot((p[0] - a[0]) * sx - t * dx, p[1] - a[1] - t * dy);
    if (d < best) {
      best = d;
      index = i;
    }
  }
  return index;
}

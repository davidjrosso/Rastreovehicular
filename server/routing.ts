import { readFileSync } from "node:fs";

export type GraphData = {
  origin: number[];
  N: number[];
  names: string[];
  W: [number, number, number, number[]][];
};
type Point = [number, number];
type Edge = { to: number; length: number; contra: boolean };
type Segment = { a: number; b: number; dir: number; length: number };
type Snap = { index: number; t: number; point: Point; distance: number };
export type Leg = {
  from: string;
  to: string;
  coordinates: Point[];
  distance: number | null;
  speed: number | null;
  warning: string | null;
  uncertain: boolean;
  notes: { id: string; reason: string }[];
  elapsed: number;
};
const KX = 111320 * Math.cos((-32.17 * Math.PI) / 180);
const KY = 110950;

export class RoadGraph {
  data: GraphData;
  points: Point[];
  adjacency: Edge[][];
  segments: Segment[] = [];
  constructor(data: GraphData) {
    this.data = data;
    this.points = Array.from({ length: data.N.length / 2 }, (_, i) => [
      (data.N[i * 2] / 1e5) * KX,
      (data.N[i * 2 + 1] / 1e5) * KY,
    ]);
    this.adjacency = this.points.map(() => []);
    for (const [kind, , dir, nodes] of data.W) {
      if (kind > 4) continue;
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1],
          b = nodes[i];
        const length = Math.hypot(
          this.points[a][0] - this.points[b][0],
          this.points[a][1] - this.points[b][1],
        );
        if (!length) continue;
        this.segments.push({ a, b, dir, length });
        this.adjacency[a].push({ to: b, length, contra: dir === -1 });
        this.adjacency[b].push({ to: a, length, contra: dir === 1 });
      }
    }
  }
  project(p: Point): Point {
    return [
      (p[0] - this.data.origin[0]) * KX,
      (p[1] - this.data.origin[1]) * KY,
    ];
  }
  unproject(p: Point): Point {
    return [this.data.origin[0] + p[0] / KX, this.data.origin[1] + p[1] / KY];
  }
  snap(lonlat: Point): Snap | null {
    const p = this.project(lonlat);
    let result: Snap | null = null;
    this.segments.forEach((s, index) => {
      const a = this.points[s.a],
        b = this.points[s.b];
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (s.length * s.length),
        ),
      );
      const point: Point = [a[0] + t * dx, a[1] + t * dy];
      const distance = Math.hypot(point[0] - p[0], point[1] - p[1]);
      if (!result || distance < result.distance)
        result = { index, t, point, distance };
    });
    return result;
  }
  route(from: Point, to: Point, relaxed = false, walking = false) {
    const a = this.snap(from),
      b = this.snap(to);
    if (!a || !b || a.distance > 120 || b.distance > 120) return null;
    const count = this.points.length,
      start = count,
      end = count + 1;
    const extra = new Map<number, Edge[]>();
    const add = (u: number, v: number, length: number, contra: boolean) => {
      const edges = extra.get(u) || [];
      edges.push({ to: v, length, contra });
      extra.set(u, edges);
    };
    for (const [snap, virtual] of [
      [a, start],
      [b, end],
    ] as [Snap, number][]) {
      const s = this.segments[snap.index];
      add(virtual, s.b, s.length * (1 - snap.t), s.dir === -1);
      add(virtual, s.a, s.length * snap.t, s.dir === 1);
      add(s.a, virtual, s.length * snap.t, s.dir === -1);
      add(s.b, virtual, s.length * (1 - snap.t), s.dir === 1);
    }
    if (a.index === b.index) {
      const s = this.segments[a.index];
      add(
        start,
        end,
        Math.abs(a.t - b.t) * s.length,
        b.t >= a.t ? s.dir === -1 : s.dir === 1,
      );
    }
    const distances = new Float64Array(count + 2).fill(Infinity);
    const previous = new Int32Array(count + 2).fill(-1);
    const previousEdge: (Edge | undefined)[] = [];
    const heap: [number, number][] = [];
    const push = (distance: number, node: number) => {
      heap.push([distance, node]);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent][0] <= heap[i][0]) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
      }
    };
    const pop = () => {
      const first = heap[0],
        last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          let min = i;
          const left = i * 2 + 1,
            right = left + 1;
          if (left < heap.length && heap[left][0] < heap[min][0]) min = left;
          if (right < heap.length && heap[right][0] < heap[min][0]) min = right;
          if (min === i) break;
          [heap[min], heap[i]] = [heap[i], heap[min]];
          i = min;
        }
      }
      return first;
    };
    distances[start] = 0;
    push(0, start);
    while (heap.length) {
      const [distance, u] = pop();
      if (distance > distances[u]) continue;
      if (u === end) break;
      for (const edge of [
        ...(this.adjacency[u] || []),
        ...(extra.get(u) || []),
      ]) {
        if (edge.contra && !relaxed && !walking) continue;
        const next = distance + edge.length * (edge.contra && !walking ? 4 : 1);
        if (next < distances[edge.to]) {
          distances[edge.to] = next;
          previous[edge.to] = u;
          previousEdge[edge.to] = edge;
          push(next, edge.to);
        }
      }
    }
    if (!Number.isFinite(distances[end])) return null;
    const coordinates: Point[] = [];
    let distance = 0,
      contra = false;
    for (let u = end; u !== -1; u = previous[u]) {
      coordinates.push(
        this.unproject(
          u === start ? a.point : u === end ? b.point : this.points[u],
        ),
      );
      const edge = previousEdge[u];
      if (edge) {
        distance += edge.length;
        contra ||= edge.contra && !walking;
      }
    }
    return { coordinates: coordinates.reverse(), distance, contra };
  }
}

const raw = JSON.parse(
  readFileSync(new URL("./assets/streets.json", import.meta.url), "utf8"),
) as GraphData;
export const graph = new RoadGraph(raw);
export const streets = {
  type: "FeatureCollection",
  features: raw.W.map(([kind, name, , nodes]) => ({
    type: "Feature",
    properties: { kind, name: raw.names[name] || "" },
    geometry: {
      type: "LineString",
      coordinates: nodes.map((n) => [
        raw.origin[0] + raw.N[n * 2] / 1e5,
        raw.origin[1] + raw.N[n * 2 + 1] / 1e5,
      ]),
    },
  })),
};

export function buildRoutes(
  targets: Record<string, any>[],
  entries: Record<string, any>[],
  routeNotes: Record<string, any>[] = [],
) {
  return targets.map((target) => {
    const captures = entries
      .filter(
        (e) =>
          e.kind === "captura" &&
          e.payload.certainty !== "dudoso" &&
          e.payload.target_ids.includes(target.id),
      )
      .sort((a, b) => Date.parse(a.payload.at) - Date.parse(b.payload.at));
    const legs: Leg[] = [];
    const center = (e: Record<string, any>): Point => {
      const cameras = e.payload.cameras;
      return [
        cameras.reduce((sum: number, c: any) => sum + c.lon, 0) /
          cameras.length,
        cameras.reduce((sum: number, c: any) => sum + c.lat, 0) /
          cameras.length,
      ];
    };
    for (let i = 1; i < captures.length; i++) {
      const a = captures[i - 1],
        b = captures[i];
      const p = center(a),
        q = center(b);
      const elapsed =
        (Date.parse(b.payload.at) - Date.parse(a.payload.at)) / 1000;
      const notes = routeNotes.filter(
        (n) =>
          n.active &&
          n.target_id === target.id &&
          ((Date.parse(b.payload.at) > new Date(n.starts_at).getTime() &&
            Date.parse(a.payload.at) < new Date(n.ends_at).getTime()) ||
            (n.from_entry_id === a.id && n.to_entry_id === b.id)),
      );
      if (notes.length) {
        legs.push({
          from: a.id,
          to: b.id,
          coordinates: [],
          distance: null,
          speed: null,
          uncertain: true,
          elapsed,
          notes: notes.map((n) => ({ id: n.id, reason: n.reason })),
          warning: `Recorrido incierto: ${notes.map((n) => n.reason).join(" · ")}`,
        });
        continue;
      }
      const spread = [a, b].some((e) => {
        const c = graph.project(center(e));
        return e.payload.cameras.some((camera: any) => {
          const v = graph.project([camera.lon, camera.lat]);
          return Math.hypot(v[0] - c[0], v[1] - c[1]) > 150;
        });
      });
      const route = spread
        ? null
        : graph.route(p, q, false, target.kind === "persona") ||
          graph.route(p, q, true, target.kind === "persona");
      const speed =
        route && elapsed > 0 ? (route.distance / elapsed) * 3.6 : null;
      const warnings: string[] = [];
      if (spread)
        warnings.push(
          "Cámaras simultáneas demasiado separadas: revisar ubicación",
        );
      else if (!route)
        warnings.push("Sin conexión verificable en el grafo de calles");
      if (route?.contra) warnings.push("El recorrido requiere contramano");
      if (elapsed <= 0) warnings.push("Capturas con la misma hora");
      if (speed !== null && (speed > 70 || speed < 3))
        warnings.push("Velocidad inusual");
      legs.push({
        from: a.id,
        to: b.id,
        coordinates: route?.coordinates || [],
        distance: route?.distance ?? null,
        speed,
        warning: warnings.join(" · ") || null,
        uncertain: false,
        notes: [],
        elapsed,
      });
    }
    return {
      target_id: target.id,
      description: target.description,
      color: target.color,
      legs,
    };
  });
}

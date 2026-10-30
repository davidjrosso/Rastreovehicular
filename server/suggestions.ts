import { z } from "zod";
import { id } from "./domain.ts";
import { graph, type RoadGraph } from "./routing.ts";

type Row = Record<string, any>;
type Point = [number, number];
export const suggestionInput = z.object({
  target_id: id,
  mode: z.enum(["direccion", "cercania"]).default("direccion"),
  heading: z
    .enum(["auto", "ninguno", "N", "NE", "E", "SE", "S", "SO", "O", "NO"])
    .default("auto"),
  speed: z.number().min(1).max(130).optional(),
  horizon_minutes: z.number().int().min(1).max(120).default(15),
  delay_minutes: z.number().int().min(0).max(60).default(0),
});
export type SuggestionOptions = z.infer<typeof suggestionInput>;

// Coverage is the union of revisions for this target (or all targets), within this window.
export function revisionCoverage(
  entries: Row[],
  cameraId: string,
  targetId: string,
  from: number,
  to: number,
) {
  const intervals = entries
    .filter(
      (e) =>
        !e.deleted_at &&
        e.kind === "revision" &&
        e.payload.camera_id === cameraId &&
        (!e.payload.target_id || e.payload.target_id === targetId),
    )
    .map((e) => [
      Math.max(from, Date.parse(e.payload.from)),
      Math.min(to, Date.parse(e.payload.to)),
    ])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0,
    end = from;
  for (const [a, b] of intervals) {
    covered += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return covered >= to - from
    ? "completa"
    : covered > 0
      ? "parcial"
      : "ninguna";
}

export function suggestCameras(
  c: Row,
  target: Row,
  cameras: Row[],
  options: SuggestionOptions,
  roads: RoadGraph = graph,
) {
  const warnings: string[] = [];
  const result = {
    target_id: target.id,
    origin: null as Row | null,
    assumptions: null as Row | null,
    warnings,
    suggestions: [] as Row[],
    message: "",
  };
  const captures = c.entries.filter(
    (e: Row) =>
      !e.deleted_at &&
      e.kind === "captura" &&
      e.payload.target_ids.includes(target.id),
  );
  const confirmed = captures
    .filter((e: Row) => e.payload.certainty === "confirmado")
    .sort(
      (a: Row, b: Row) =>
        Date.parse(a.payload.at) - Date.parse(b.payload.at) ||
        a.id.localeCompare(b.id),
    );
  if (!confirmed.length)
    return {
      ...result,
      message:
        "Registrá una captura confirmada de este objetivo para sugerir dónde continuar.",
    };
  const latest = confirmed.at(-1)!;
  const start = Date.parse(latest.payload.at);
  const groupAt = (at: number) =>
    confirmed
      .filter((e: Row) => Date.parse(e.payload.at) === at)
      .flatMap((e: Row) => e.payload.cameras);
  const center = (cams: Row[]): Point => [
    cams.reduce((n, c) => n + c.lon, 0) / cams.length,
    cams.reduce((n, c) => n + c.lat, 0) / cams.length,
  ];
  const distance = (a: Point, b: Point) => {
    const p = roads.project(a),
      q = roads.project(b);
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  };
  const originCameras = groupAt(start),
    origin = center(originCameras);
  result.origin = {
    entry_id: latest.id,
    at: latest.payload.at,
    cameras: originCameras,
    lon: origin[0],
    lat: origin[1],
  };
  if (
    originCameras.some((cam: Row) => distance(origin, [cam.lon, cam.lat]) > 150)
  )
    return {
      ...result,
      message:
        "Las cámaras de la última aparición están demasiado separadas. Aclará esa ubicación antes de calcular sugerencias.",
    };
  const originSnap = roads.snap(origin);
  if (!originSnap || originSnap.distance > 120)
    return {
      ...result,
      message:
        "La última captura está fuera de la cobertura del mapa de calles. Revisá su ubicación antes de calcular sugerencias.",
    };
  const end = Math.min(
    c.ends_at ? new Date(c.ends_at).getTime() : Infinity,
    start + options.horizon_minutes * 60000,
  );
  if (end <= start)
    return {
      ...result,
      message:
        "La última captura está al final de la franja del pedido; no queda un horario posterior para revisar.",
    };
  const walking = target.kind === "persona";
  const previous = confirmed
    .filter((e: Row) => Date.parse(e.payload.at) < start)
    .at(-1);
  const gap = previous ? (start - Date.parse(previous.payload.at)) / 60000 : 0;
  const recentUncertainty = (c.route_notes || []).some(
    (n: Row) =>
      n.active &&
      n.target_id === target.id &&
      new Date(n.starts_at).getTime() <= start &&
      (previous
        ? new Date(n.ends_at).getTime() > Date.parse(previous.payload.at)
        : new Date(n.ends_at).getTime() >= start),
  );
  const laterUnconfirmed = captures.some(
    (e: Row) => Date.parse(e.payload.at) > start,
  );
  const longGap = gap > (walking ? 20 : 10);
  const cautious = recentUncertainty || longGap || laterUnconfirmed;
  if (recentUncertainty)
    warnings.push(
      "Hay incertidumbre en el intervalo previo: no se deduce su dirección ni su velocidad.",
    );
  if (longGap)
    warnings.push(
      `Pasaron ${Math.round(gap)} minutos entre las últimas capturas confirmadas: pudo haber una detención o un desvío.`,
    );
  if (laterUnconfirmed)
    warnings.push(
      "Hay apariciones posteriores sin confirmar. Se mantiene como origen la última confirmada y se amplían las alternativas.",
    );
  let previousRoute: ReturnType<RoadGraph["route"]> = null;
  if (previous && !cautious) {
    const cams = groupAt(Date.parse(previous.payload.at)),
      p = center(cams);
    if (cams.every((cam: Row) => distance(p, [cam.lon, cam.lat]) <= 150))
      previousRoute = roads.route(p, origin, false, walking);
  }
  let speed = options.speed ?? (walking ? 4.5 : 30);
  let speedSource = options.speed
    ? "indicada por el operador"
    : `supuesto inicial para ${walking ? "peatón" : "vehículo"}; ajustable`;
  if (!options.speed && previousRoute && gap > 0) {
    const observed = (previousRoute.distance / (gap * 60)) * 3.6;
    if (observed >= (walking ? 2 : 5) && observed <= (walking ? 8 : 70)) {
      speed = Math.round(observed * 10) / 10;
      speedSource = "estimada con el último tramo confirmado sin incertidumbre";
    }
  }
  // Headings use map-space vectors. Auto follows the final 30 m of the preceding road path.
  const compass: Record<string, Point> = {
    N: [0, 1],
    NE: [1, 1],
    E: [1, 0],
    SE: [1, -1],
    S: [0, -1],
    SO: [-1, -1],
    O: [-1, 0],
    NO: [-1, 1],
  };
  let heading: Point | null = null,
    headingSource = "sin dirección preferida";
  if (options.mode === "direccion") {
    if (compass[options.heading]) {
      heading = compass[options.heading];
      headingSource = `sentido ${options.heading} indicado por el operador`;
    } else if (
      options.heading === "auto" &&
      previousRoute &&
      previousRoute.distance >= 30
    ) {
      const path = previousRoute.coordinates,
        last = path.at(-1)!;
      const prior = [...path].reverse().find((p) => distance(p, last) >= 30);
      if (prior) {
        const a = roads.project(prior),
          b = roads.project(last);
        heading = [b[0] - a[0], b[1] - a[1]];
        headingSource = "continuidad del último tramo confirmado";
      }
    }
  }
  const delay = Math.max(options.delay_minutes, cautious ? 5 : 0);
  result.assumptions = {
    speed,
    speed_source: speedSource,
    heading_source: headingSource,
    delay_minutes: delay,
    horizon_minutes: options.horizon_minutes,
    until: new Date(end).toISOString(),
    cautious,
    mode: options.mode,
  };
  if (cautious)
    warnings.push(
      "Se agrega un margen de al menos 5 minutos por posible demora. Podés ampliarlo.",
    );
  const originIds = new Set(originCameras.map((cam: Row) => cam.id));
  const candidates: Row[] = [];
  let unreachable = 0;
  for (const cam of cameras) {
    if (cam.active === false || originIds.has(cam.id)) continue;
    const p: Point = [cam.lon, cam.lat];
    // A lower bound avoids routing cameras that cannot fall within the chosen horizon.
    if ((distance(origin, p) / ((speed * 1.5) / 3.6)) * 1000 > end - start)
      continue;
    const route = roads.route(origin, p, false, walking);
    if (!route) {
      unreachable++;
      continue;
    }
    if (route.distance < 5) continue;
    const earliest = Math.max(
      start + 1000,
      Math.floor(
        (start + (route.distance / ((speed * 1.5) / 3.6)) * 1000 - 30000) /
          60000,
      ) * 60000,
    );
    if (earliest >= end) continue;
    const latestAt = Math.min(
      end,
      Math.ceil(
        (start +
          (route.distance / ((speed * 0.5) / 3.6)) * 1000 +
          delay * 60000 +
          30000) /
          60000,
      ) * 60000,
    );
    const arrival = Math.min(
      latestAt,
      Math.max(
        earliest,
        start + Math.round(route.distance / (speed / 3.6)) * 1000,
      ),
    );
    const projected = roads.project(p),
      anchor = roads.project(origin);
    const vector: Point = [projected[0] - anchor[0], projected[1] - anchor[1]];
    const departure =
      route.coordinates.find((pt) => distance(origin, pt) >= 30) ||
      route.coordinates.at(-1)!;
    const depart = roads.project(departure);
    const cosine = (v: Point) =>
      heading
        ? (v[0] * heading[0] + v[1] * heading[1]) /
          (Math.hypot(...v) * Math.hypot(...heading) || 1)
        : 0;
    const alignment = heading
      ? (cosine(vector) +
          cosine([depart[0] - anchor[0], depart[1] - anchor[1]])) /
        2
      : 0;
    const coverage = revisionCoverage(
      c.entries,
      cam.id,
      target.id,
      earliest,
      latestAt,
    );
    const reasons = [
      `${Math.round(route.distance)} m por calles ${walking ? "transitables a pie" : "respetando los sentidos de circulación"}.`,
    ];
    if (heading)
      reasons.push(
        alignment >= 0.5
          ? "Continúa la dirección priorizada."
          : alignment < -0.25
            ? "Alternativa con cambio de dirección."
            : "Alternativa lateral o por un giro.",
      );
    else
      reasons.push(
        "Priorizada por cercanía por calles; sin suponer un sentido de salida.",
      );
    if (coverage === "completa")
      reasons.push(
        "La franja ya fue revisada sin resultado; prioridad reducida.",
      );
    else if (coverage === "parcial")
      reasons.push(
        "Parte de la franja ya fue revisada; aún quedan horarios por cubrir.",
      );
    else
      reasons.push(
        "Sin revisión registrada para este objetivo en esta franja.",
      );
    candidates.push({
      camera: {
        id: cam.id,
        number: cam.number,
        name: cam.name,
        lon: cam.lon,
        lat: cam.lat,
      },
      target_id: target.id,
      distance: Math.round(route.distance),
      from: new Date(earliest).toISOString(),
      to: new Date(latestAt).toISOString(),
      at: new Date(arrival).toISOString(),
      coverage,
      reasons,
      priority:
        coverage === "completa"
          ? "baja"
          : !cautious &&
              coverage === "ninguna" &&
              (!heading || alignment >= 0.5)
            ? "alta"
            : "media",
      cost: route.distance * (heading ? 1 + (1 - alignment) * 0.8 : 1),
      sector:
        (Math.round(Math.atan2(vector[1], vector[0]) / (Math.PI / 4)) + 8) % 8,
      coverageOrder:
        coverage === "completa" ? 2 : coverage === "parcial" ? 1 : 0,
    });
  }
  const sectors = new Map<number, number>();
  const chosen: Row[] = [];
  // A soft diversity penalty surfaces nearby alternate exits, without promoting reviewed windows.
  while (candidates.length && chosen.length < 5) {
    const cost = (r: Row) =>
      r.cost *
      (options.mode === "direccion"
        ? 1 + 0.45 * (sectors.get(r.sector) || 0)
        : 1);
    candidates.sort(
      (a, b) =>
        a.coverageOrder - b.coverageOrder ||
        cost(a) - cost(b) ||
        a.camera.number - b.camera.number,
    );
    const next = candidates.shift()!;
    sectors.set(next.sector, (sectors.get(next.sector) || 0) + 1);
    const {
      cost: _,
      sector: __,
      coverageOrder: ___,
      ...publicSuggestion
    } = next;
    chosen.push({ ...publicSuggestion, rank: chosen.length + 1 });
  }
  if (unreachable)
    warnings.push(
      `${unreachable} cámaras omitidas por falta de conexión verificable en el mapa de calles.`,
    );
  return {
    ...result,
    suggestions: chosen,
    message: chosen.length
      ? ""
      : "No hay otras cámaras alcanzables dentro de esta franja. Probá ampliar el horizonte o revisar la ubicación de origen.",
  };
}

import { useMemo } from "react";
type Row = Record<string, any>;

// Vector map: prints without WebGL screenshots or external map services.
export function ReportMap({
  points,
  routes,
  streets,
}: {
  points: Row[];
  routes: Row[];
  streets: Row | null;
}) {
  const drawing = useMemo(() => {
    if (!points.length) return null;
    const coords = points
      .map((p) => [p.lon, p.lat])
      .concat(
        routes.flatMap((r) =>
          r.legs
            .filter((l: Row) => !l.uncertain)
            .flatMap((l: Row) => l.coordinates),
        ),
      );
    const lat = coords.reduce((sum, p) => sum + p[1], 0) / coords.length;
    const sx = 111320 * Math.cos((lat * Math.PI) / 180),
      sy = 111320;
    const xs = coords.map((p) => p[0] * sx),
      ys = coords.map((p) => -p[1] * sy);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const scale = Math.min(
      820 / Math.max(500, maxX - minX),
      400 / Math.max(350, maxY - minY),
    );
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2;
    const project = (p: number[]) => [
      450 + (p[0] * sx - cx) * scale,
      235 + (-p[1] * sy - cy) * scale,
    ];
    const inside = (p: number[]) =>
      p[0] > -40 && p[0] < 940 && p[1] > -40 && p[1] < 510;
    const path = (coordinates: number[][]) =>
      coordinates
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${project(p)
              .map((v) => v.toFixed(1))
              .join(",")}`,
        )
        .join(" ");
    const occupied = new Set<string>();
    const roads = (streets?.features || []).flatMap((f: Row, i: number) => {
      const coordinates = f.geometry.coordinates;
      const projected = coordinates.map(project);
      if (!projected.some(inside)) return [];
      const mid = projected[Math.floor(projected.length / 2)];
      const cell = `${Math.floor(mid[0] / 140)},${Math.floor(mid[1] / 65)}`;
      const label =
        f.properties.name &&
        f.properties.kind <= 4 &&
        inside(mid) &&
        !occupied.has(cell);
      if (label) occupied.add(cell);
      return [
        {
          key: i,
          d: path(coordinates),
          kind: f.properties.kind,
          name: label ? f.properties.name : "",
          mid,
        },
      ];
    });
    const counts = new Map<string, number>();
    const markers = points.map((p) => {
      const at = project([p.lon, p.lat]);
      const cell = `${Math.round(at[0] / 28)},${Math.round(at[1] / 28)}`;
      const offset = counts.get(cell) || 0;
      counts.set(cell, offset + 1);
      return {
        ...p,
        at,
        label: [
          Math.max(18, Math.min(882, at[0] + (offset % 3) * 30)),
          Math.max(25, Math.min(445, at[1] - Math.floor(offset / 3) * 30)),
        ],
      };
    });
    const meters =
      [25, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
        .filter((n) => n * scale <= 140)
        .at(-1) || 25;
    return { roads, markers, path, scale, meters };
  }, [points, routes, streets]);
  if (!drawing)
    return (
      <div className="report-map-empty">
        Todavía no hay capturas ni lugares con ubicación para dibujar el mapa.
      </div>
    );
  return (
    <svg
      className="report-map"
      viewBox="0 0 900 470"
      role="img"
      aria-label="Mapa del evento con hitos numerados y recorridos estimados"
    >
      <rect width="900" height="470" fill="#edf1ed" />
      {drawing.roads.map((r: Row) => (
        <path
          key={r.key}
          d={r.d}
          fill="none"
          stroke={r.kind === 9 ? "#8ebec8" : r.kind === 8 ? "#bac2ba" : "#fff"}
          strokeWidth={r.kind === 9 ? 8 : 3}
        />
      ))}
      {drawing.roads
        .filter((r: Row) => r.name)
        .map((r: Row) => (
          <text
            key={r.key}
            x={r.mid[0]}
            y={r.mid[1]}
            textAnchor="middle"
            fontSize="10"
            fill="#6d7c76"
          >
            {r.name}
          </text>
        ))}
      {routes.flatMap((r) =>
        r.legs
          .filter((l: Row) => !l.uncertain && l.coordinates.length > 1)
          .map((l: Row, i: number) => (
            <path
              key={`${r.target_id}-${i}`}
              d={drawing.path(l.coordinates)}
              fill="none"
              stroke={r.color}
              strokeWidth="4"
              strokeDasharray="8 4"
              opacity=".85"
            />
          )),
      )}
      {drawing.markers.map((p: Row) => (
        <g key={p.key}>
          <title>
            {p.sequence} · {p.name}
          </title>
          <line
            x1={p.at[0]}
            y1={p.at[1]}
            x2={p.label[0]}
            y2={p.label[1]}
            stroke={p.color}
          />
          <circle
            cx={p.label[0]}
            cy={p.label[1]}
            r="13"
            fill={p.color}
            stroke="white"
            strokeWidth="2"
          />
          <text
            x={p.label[0]}
            y={p.label[1] + 4}
            fontSize="11"
            fontWeight="bold"
            textAnchor="middle"
            fill="white"
          >
            {p.sequence}
          </text>
        </g>
      ))}
      <g transform="translate(850 20)">
        <text x="0" y="12" textAnchor="middle" fontSize="13" fill="#213a3c">
          N
        </text>
        <path d="M0 20 L-5 34 L0 30 L5 34 Z" fill="#213a3c" />
      </g>
      <g transform="translate(25 438)">
        <rect
          x="-8"
          y="-17"
          width="165"
          height="37"
          fill="white"
          opacity=".9"
        />
        <path
          d={`M0 0 v6 h${drawing.meters * drawing.scale} v-6`}
          fill="none"
          stroke="#213a3c"
          strokeWidth="2"
        />
        <text x="0" y="-4" fontSize="10">
          {drawing.meters >= 1000
            ? `${drawing.meters / 1000} km`
            : `${drawing.meters} m`}{" "}
          aprox.
        </text>
      </g>
      <text x="890" y="460" textAnchor="end" fontSize="9" fill="#536760">
        © OpenStreetMap · ODbL · cartografía octubre 2026
      </text>
    </svg>
  );
}

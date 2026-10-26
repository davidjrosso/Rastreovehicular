type Row = Record<string, any>;
export const certaintyLabels: Record<string, string> = {
  confirmado: "Confirmado",
  probable: "Probable",
  dudoso: "Dudoso",
};
export function reportModel(data: Row, targetId = "all") {
  const targets: Row[] = data.targets.filter(
    (t: Row) => targetId === "all" || t.id === targetId,
  );
  const ids = new Set(targets.map((t) => t.id));
  const entries: Row[] = data.entries.filter(
    (e: Row) =>
      !e.deleted_at &&
      (e.kind === "aporte" ||
        (e.kind === "captura" &&
          e.payload.target_ids.some((id: string) => ids.has(id))) ||
        (e.kind === "revision" &&
          (!e.payload.target_id || ids.has(e.payload.target_id)))),
  );
  const captures = entries.filter((e) => e.kind === "captura");
  const confirmed = captures.filter(
    (e) => e.payload.certainty === "confirmado",
  );
  const reviews = entries
    .filter((e) => e.kind === "revision")
    .sort((a, b) => Date.parse(a.payload.from) - Date.parse(b.payload.from));
  const timeline: (Row & { sequence: number })[] = entries
    .filter((e) => e.kind !== "revision")
    .sort((a, b) => {
      const at = a.payload.at ? Date.parse(a.payload.at) : Infinity;
      const bt = b.payload.at ? Date.parse(b.payload.at) : Infinity;
      return (at === bt ? 0 : at - bt) || a.id.localeCompare(b.id);
    })
    .map((e, index) => ({ ...e, sequence: index + 1 }));
  const byEntry = new Map(timeline.map((e) => [e.id, e.sequence]));
  const points: Row[] = timeline.flatMap((e) => {
    const cameras: Row[] =
      e.kind === "captura"
        ? e.payload.cameras
        : Number.isFinite(e.payload.lon) && Number.isFinite(e.payload.lat)
          ? [
              {
                lon: e.payload.lon,
                lat: e.payload.lat,
                name: e.payload.place_name || "Aporte",
                number: null,
              },
            ]
          : [];
    return cameras
      .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))
      .map((p, index) => ({
        ...p,
        key: `${e.id}-${index}`,
        sequence: e.sequence,
        color:
          e.kind === "aporte"
            ? "#ac6928"
            : e.payload.certainty === "confirmado"
              ? "#236c60"
              : "#73558e",
        kind: e.kind,
        certainty: e.payload.certainty,
      }));
  });
  const routes: Row[] = (data.routes || []).filter((r: Row) =>
    ids.has(r.target_id),
  );
  const warnings = routes.flatMap((r) =>
    r.legs
      .filter((l: Row) => l.warning || l.uncertain)
      .map((l: Row) => ({
        ...l,
        target: r.description,
        fromNumber: byEntry.get(l.from),
        toNumber: byEntry.get(l.to),
      })),
  );
  const notes: Row[] = (data.route_notes || []).filter(
    (n: Row) => n.active && ids.has(n.target_id),
  );
  const suggestions: Row[] = (data.suggestions || []).filter((s: Row) =>
    ids.has(s.target_id),
  );
  const attachments: Row[] = (data.attachments || []).filter((a: Row) =>
    timeline.some((e) => e.id === a.entry_id),
  );
  const reviewedCameras = new Set(reviews.map((e) => e.payload.camera_id)).size;
  const pending: string[] = [];
  for (const target of targets) {
    const observations = confirmed.filter((e) =>
      e.payload.target_ids.includes(target.id),
    );
    if (!observations.length)
      pending.push(
        `${target.description}: sin apariciones confirmadas registradas.`,
      );
  }
  if (captures.length > confirmed.length)
    pending.push(
      `${captures.length - confirmed.length} captura(s) probable(s) o dudosa(s) requieren corroboración.`,
    );
  if (notes.length)
    pending.push(
      `${notes.length} anotación(es) de recorrido incierto permanecen activas.`,
    );
  if (
    entries.some(
      (e) =>
        e.kind === "aporte" && e.payload.place_kind === "camara_particular",
    )
  )
    pending.push(
      "Contrastar los avistamientos aportados por cámaras particulares con las capturas confirmadas.",
    );
  return {
    targets,
    captures,
    confirmed,
    reviews,
    timeline,
    points,
    routes,
    warnings,
    notes,
    suggestions,
    attachments,
    reviewedCameras,
    pending,
  };
}

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import fontUrl from "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { api, time } from "./api";

maplibregl.setWorkerUrl(workerUrl);

export function CityMap({
  cameras,
  detail,
  onCamera,
}: {
  cameras: any[];
  detail?: any;
  onCamera?: (camera: any) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const click = useRef(onCamera);
  click.current = onCamera;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let instance: maplibregl.Map;
    try {
      instance = new maplibregl.Map({
        container: container.current!,
        center: [-64.114, -32.174],
        zoom: 13.2,
        style: {
          version: 8,
          "font-faces": { Noto: fontUrl },
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#e9eeeb" },
            },
          ],
        },
        attributionControl: false,
      });
      map.current = instance;
      instance.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      instance.addControl(
        new maplibregl.AttributionControl({
          compact: true,
          customAttribution:
            "© colaboradores de OpenStreetMap · ODbL · octubre 2026",
        }),
      );
      instance.on("error", () => {
        if (alive)
          setError(
            "No se pudo dibujar una capa del mapa. Recargá la página para reintentar.",
          );
      });
      instance.on("load", async () => {
        try {
          const streets = await api("/streets");
          if (!alive) return;
          instance.addSource("streets", { type: "geojson", data: streets });
          instance.addLayer({
            id: "water",
            type: "line",
            source: "streets",
            filter: ["==", ["get", "kind"], 9],
            paint: { "line-color": "#9bc9ce", "line-width": 8 },
          });
          instance.addLayer({
            id: "road-outline",
            type: "line",
            source: "streets",
            filter: ["<=", ["get", "kind"], 4],
            paint: {
              "line-color": "#d1dad6",
              "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                11,
                2,
                16,
                14,
              ],
            },
          });
          instance.addLayer({
            id: "roads",
            type: "line",
            source: "streets",
            filter: ["<=", ["get", "kind"], 4],
            paint: {
              "line-color": [
                "case",
                ["<=", ["get", "kind"], 2],
                "#faf7eb",
                "#ffffff",
              ],
              "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                11,
                1,
                16,
                10,
              ],
            },
          });
          instance.addLayer({
            id: "rail",
            type: "line",
            source: "streets",
            filter: ["==", ["get", "kind"], 8],
            paint: {
              "line-color": "#aab8b1",
              "line-width": 2,
              "line-dasharray": [3, 3],
            },
          });
          instance.addLayer({
            id: "street-names",
            type: "symbol",
            source: "streets",
            minzoom: 13,
            filter: ["<=", ["get", "kind"], 4],
            layout: {
              "symbol-placement": "line",
              "text-field": ["get", "name"],
              "text-font": ["Noto"],
              "text-size": 10,
              "symbol-spacing": 250,
            },
            paint: {
              "text-color": "#82918a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.5,
            },
          });
          instance.addSource("routes", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          instance.addLayer({
            id: "route-halo",
            type: "line",
            source: "routes",
            paint: { "line-color": "#ffffff", "line-width": 8 },
          });
          instance.addLayer({
            id: "route-line",
            type: "line",
            source: "routes",
            paint: { "line-color": ["get", "color"], "line-width": 4 },
          });
          instance.addSource("cameras", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          instance.addLayer({
            id: "camera-points",
            type: "circle",
            source: "cameras",
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                11,
                3,
                16,
                7,
              ],
              "circle-color": ["get", "color"],
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#ffffff",
            },
          });
          instance.on("click", "camera-points", (e) => {
            const props = e.features?.[0]?.properties;
            if (props) click.current?.(props);
          });
          const popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
          });
          instance.on("mouseenter", "camera-points", (e) => {
            instance.getCanvas().style.cursor = "pointer";
            const feature = e.features?.[0];
            if (feature?.geometry.type === "Point")
              popup
                .setLngLat(feature.geometry.coordinates as [number, number])
                .setText(feature.properties.name)
                .addTo(instance);
          });
          instance.on("mouseleave", "camera-points", () => {
            instance.getCanvas().style.cursor = "";
            popup.remove();
          });
          setReady(true);
        } catch (err) {
          if (alive) setError((err as Error).message);
        }
      });
    } catch {
      setError(
        "El navegador no pudo iniciar el mapa. La cronología sigue disponible.",
      );
    }
    return () => {
      alive = false;
      instance?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const captures =
      detail?.entries?.filter((e: any) => e.kind === "captura") || [];
    const revisions =
      detail?.entries?.filter((e: any) => e.kind === "revision") || [];
    const color = (cameraId: string) => {
      const capture = captures.find((e: any) =>
        e.payload.camera_ids.includes(cameraId),
      );
      if (capture)
        return (
          detail.targets.find((t: any) =>
            capture.payload.target_ids.includes(t.id),
          )?.color || "#e79244"
        );
      return revisions.some((e: any) => e.payload.camera_id === cameraId)
        ? "#a0aaa5"
        : "#217875";
    };
    const allCameras = cameras.length
      ? cameras
      : captures.flatMap((e: any) => e.payload.cameras);
    (instance.getSource("cameras") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: allCameras.map((c: any) => ({
        type: "Feature",
        properties: { ...c, color: color(c.id) },
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
      })),
    });
    (instance.getSource("routes") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (detail?.routes || []).flatMap((r: any) =>
        r.legs
          .filter((l: any) => l.coordinates.length > 1)
          .map((l: any) => ({
            type: "Feature",
            properties: { color: l.warning ? "#be673b" : r.color },
            geometry: { type: "LineString", coordinates: l.coordinates },
          })),
      ),
    });
    const markers: maplibregl.Marker[] = [];
    for (const e of captures) {
      for (const c of e.payload.cameras) {
        const el = document.createElement("div");
        el.className = `capture-pin ${e.payload.certainty === "dudoso" ? "doubt" : ""}`;
        el.style.borderColor = color(c.id);
        el.textContent = `${time(e.payload.at)} · ${c.number}`;
        el.title = `${e.payload.certainty} · ${c.name}`;
        markers.push(
          new maplibregl.Marker({
            element: el,
            anchor: "bottom",
            offset: [0, -10],
          })
            .setLngLat([c.lon, c.lat])
            .addTo(instance),
        );
      }
    }
    for (const r of detail?.routes || [])
      for (const l of r.legs) {
        const coordinates = l.coordinates;
        if (coordinates.length < 2) continue;
        const i = Math.max(1, Math.floor(coordinates.length / 2)),
          a = instance.project(coordinates[i - 1]),
          b = instance.project(coordinates[i]);
        const el = document.createElement("span");
        el.className = "route-arrow";
        el.textContent = "➤";
        el.style.color = r.color;
        markers.push(
          new maplibregl.Marker({
            element: el,
            rotation: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
            rotationAlignment: "map",
          })
            .setLngLat(coordinates[i])
            .addTo(instance),
        );
      }
    for (const e of detail?.entries?.filter(
      (e: any) => e.kind === "aporte" && e.payload.lon !== undefined,
    ) || []) {
      const el = document.createElement("div");
      el.className = "contribution-pin";
      el.textContent = "+";
      markers.push(
        new maplibregl.Marker({ element: el })
          .setLngLat([e.payload.lon, e.payload.lat])
          .setPopup(new maplibregl.Popup().setText(e.payload.text))
          .addTo(instance),
      );
    }
    return () => markers.forEach((m) => m.remove());
  }, [ready, cameras, detail]);
  useEffect(() => {
    if (!ready || !map.current || !detail) return;
    const captures = detail.entries.filter((e: any) => e.kind === "captura");
    const coordinates = captures.flatMap((e: any) =>
      e.payload.cameras.map((c: any) => [c.lon, c.lat]),
    );
    if (coordinates.length) {
      const bounds = new maplibregl.LngLatBounds();
      coordinates.forEach((p: [number, number]) => bounds.extend(p));
      map.current.fitBounds(bounds, {
        padding: 80,
        maxZoom: 15,
        duration: 400,
      });
    }
  }, [ready, detail?.id]);
  return (
    <div className="city-map">
      <div ref={container} className="map-canvas" />
      {error && (
        <p className="map-error" role="alert">
          {error}
        </p>
      )}
      <div className="map-caption">
        <span className="live-dot" /> RÍO TERCERO{" "}
        <span>Mapa local · calles y cámaras</span>
      </div>
      <div className="map-legend">
        <span>
          <i style={{ background: "#217875" }} /> Sin revisar
        </span>
        <span>
          <i style={{ background: "#a0aaa5" }} /> Con revisión
        </span>
        <span>
          <i style={{ background: "#e79244" }} /> Con captura
        </span>
      </div>
    </div>
  );
}

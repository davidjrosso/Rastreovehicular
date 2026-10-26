import { fmt } from "./api";

export function healthStatus(camera: any) {
  if (
    !camera.health_expires_at ||
    Date.parse(camera.health_expires_at) <= Date.now()
  )
    return "unknown";
  return camera.health_status === "online"
    ? "online"
    : camera.health_status === "offline"
      ? "offline"
      : "unknown";
}
export const healthLabels = {
  online: "En línea",
  offline: "Fuera de línea",
  unknown: "Sin información reciente",
};
export const healthColors = {
  online: "#169552",
  offline: "#d32236",
  unknown: "#737b88",
};
export function CameraHealth({ camera }: { camera: any }) {
  const status = healthStatus(camera);
  return (
    <small
      className={`camera-health ${status}`}
      title={`Estado actual de conexión${camera.health_checked_at ? ` · Última consulta: ${fmt(camera.health_checked_at)}` : " · Sin consulta a HikCentral"}`}
    >
      <i />
      {healthLabels[status]}
    </small>
  );
}

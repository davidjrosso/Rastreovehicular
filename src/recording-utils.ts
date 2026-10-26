export const recordingLabels = {
  complete: "Grabación en toda la franja",
  partial: "Grabación parcial",
  none: "Sin grabaciones encontradas",
  unknown: "No verificable",
};
export const recordingColors = {
  complete: "#169552",
  partial: "#bb810b",
  none: "#d32236",
  unknown: "#737b88",
};
export function recordingStatus(result: any): keyof typeof recordingLabels {
  if (
    !result?.checked_at ||
    Date.now() - Date.parse(result.checked_at) > 300000
  )
    return "unknown";
  return ["complete", "partial", "none"].includes(result.status)
    ? result.status
    : "unknown";
}

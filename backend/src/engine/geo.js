// Travel-time model. Deliberately simple and deterministic so plans are explainable.
const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function kmBetween(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const ROAD_FACTOR = 1.35; // straight line -> road distance
const SPEED_KMH = 42; // emergency vehicle average with siren in city traffic

export function travelMin(a, b) {
  if (a.id && b.id && a.id === b.id) return 0;
  return (kmBetween(a, b) * ROAD_FACTOR * 60) / SPEED_KMH;
}

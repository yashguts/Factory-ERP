/**
 * Site geotag + straight-line distance from the factory (operator, 15 Nov 2026).
 *
 * LT Construction works out one geotag per job — the most accurate GPS fix across the site measurement
 * sheet, the readiness survey and the final-audit photos — and pushes it to the job's CRM. The CRM's
 * erp_job_financials feed now carries it (site_geotag_lat / _lng / _accuracy_m / _at), so the ERP shows
 * the site on a map and how far it is from the factory for transport planning.
 *
 * The factory's own coordinates default to the Chak Chatta factory as LT AMC's office_location table
 * has it (FACTORY_DEFAULT below); FACTORY_LAT / FACTORY_LNG in the server environment override them.
 * The distance is great-circle (haversine) — "as the crow flies", not a road route.
 *
 * Plain module (no "use server"): the server actions import the readers, the client panel imports the
 * formatters only.
 */

export interface SiteGeotag {
  lat: number;
  lng: number;
  /** Accuracy radius (m) as the phone reported it, when the CRM has it. */
  accuracyM: number | null;
  /** ISO timestamp of the capture, when the CRM has it. */
  at: string | null;
}

interface GeotagFeedFields {
  site_geotag_lat?: number | string | null;
  site_geotag_lng?: number | string | null;
  site_geotag_accuracy_m?: number | string | null;
  site_geotag_at?: string | null;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The feed row's geotag, or null while the CRM has none (an older feed without the columns included). */
export function siteGeotagOf(row: GeotagFeedFields): SiteGeotag | null {
  const lat = toNum(row.site_geotag_lat);
  const lng = toNum(row.site_geotag_lng);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, accuracyM: toNum(row.site_geotag_accuracy_m), at: row.site_geotag_at ?? null };
}

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The factory at Chak Chatta, as LT AMC's office_location table has it (15 Nov 2026): the centroid of its
 * four FACTORY / factory points — Factory 1 (22.485259, 88.255637), Factory 2 (22.485326, 88.255913),
 * Factory 3 Entrance (22.485349, 88.256254), Park Smart Factory (22.485466, 88.256155) — which lie within
 * ~70 m of each other, nothing against site distances of tens of kilometres.
 */
export const FACTORY_DEFAULT = { lat: 22.48535, lng: 88.25599 } as const;

/**
 * The factory's coordinates: FACTORY_LAT / FACTORY_LNG when both are set and sane (an override, e.g. a
 * second plant), otherwise the Chak Chatta default above. Server only.
 */
export function factoryCoordinates(): { lat: number; lng: number } {
  const lat = toNum(process.env.FACTORY_LAT);
  const lng = toNum(process.env.FACTORY_LNG);
  if (lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
    return { lat, lng };
  }
  return FACTORY_DEFAULT;
}

/** Straight-line km from the factory to the site; null without a geotag. */
export function factoryDistanceKm(geo: SiteGeotag | null): number | null {
  if (!geo) return null;
  const f = factoryCoordinates();
  return haversineKm(f.lat, f.lng, geo.lat, geo.lng);
}

/** "≈ 850 m", "≈ 12.4 km", "≈ 1,240 km". */
export function formatDistanceKm(km: number): string {
  if (km < 1) return `≈ ${Math.round(km * 1000)} m`;
  if (km < 100) return `≈ ${km.toFixed(1)} km`;
  return `≈ ${Math.round(km).toLocaleString("en-IN")} km`;
}

/** "±1.6 m", "±12 m", "±1.2 km"; "accuracy unknown" without one. */
export function formatAccuracyM(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "accuracy unknown";
  if (m >= 1000) return `±${(m / 1000).toFixed(1)} km`;
  return m < 10 ? `±${m.toFixed(1)} m` : `±${Math.round(m)} m`;
}

/** The Google Maps link the whole company uses for a site. */
export function mapsUrl(geo: SiteGeotag): string {
  return `https://www.google.com/maps?q=${geo.lat},${geo.lng}`;
}

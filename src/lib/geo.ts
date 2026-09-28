const EARTH_RADIUS_METERS = 6371000;
const METERS_PER_KILOMETER = 1000;

/** Convert decimal degrees to radians for the spherical trig below. */
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two coordinates, in metres, via the haversine
 * formula.
 *
 * Accurate over the short ranges a geofence cares about and needs no
 * projection, so a Guardian Circle's radius means the same thing everywhere.
 *
 * @param fromLat Latitude of the origin point, in decimal degrees.
 * @param fromLng Longitude of the origin point, in decimal degrees.
 * @param toLat Latitude of the target point, in decimal degrees.
 * @param toLng Longitude of the target point, in decimal degrees.
 * @returns The distance along the earth's surface in metres.
 */
export const distanceMeters = (
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number => {
  const latDelta = toRadians(toLat - fromLat);
  const lngDelta = toRadians(toLng - fromLng);
  const fromLatRadians = toRadians(fromLat);
  const toLatRadians = toRadians(toLat);

  const haversine =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(fromLatRadians) *
      Math.cos(toLatRadians) *
      Math.sin(lngDelta / 2) *
      Math.sin(lngDelta / 2);

  // Clamp before asin: floating point can push the haversine a hair above 1
  // for near-antipodal points, which would otherwise yield NaN.
  const centralAngle = 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));

  return EARTH_RADIUS_METERS * centralAngle;
};

/**
 * Whether a point falls inside a circular geofence centred on another point.
 *
 * Compares the great-circle distance against the radius directly, treating the
 * boundary itself as inside so a member standing exactly on the edge still
 * triggers.
 *
 * @param lat Latitude of the point being tested, in decimal degrees.
 * @param lng Longitude of the point being tested, in decimal degrees.
 * @param centerLat Latitude of the geofence centre, in decimal degrees.
 * @param centerLng Longitude of the geofence centre, in decimal degrees.
 * @param radiusMeters The geofence radius in metres.
 * @returns True when the point is within the radius of the centre.
 */
export const isWithinRadius = (
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
): boolean => distanceMeters(lat, lng, centerLat, centerLng) <= radiusMeters;

/**
 * Render a metre distance for humans, always in metric units.
 *
 * Stays in metres below 1 km — where "0.9 km" loses useful precision for
 * someone deciding whether to walk — and switches to one decimal place of
 * kilometres above it, so an alert reads "850 m" or "1.4 km".
 *
 * @param meters The distance to render, in metres.
 * @returns The distance as a short metric string with its unit.
 */
export const formatDistance = (meters: number): string => {
  if (Math.abs(meters) < METERS_PER_KILOMETER) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / METERS_PER_KILOMETER).toFixed(1)} km`;
};

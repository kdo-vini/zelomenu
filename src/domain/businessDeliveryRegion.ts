import type { Business } from '../data/types.ts';

export interface GeographicCoordinates {
  latitude: number;
  longitude: number;
}

export function distanceInKm(from: GeographicCoordinates, to: GeographicCoordinates): number {
  const earthRadius = 6371;
  const latitudeDelta = (to.latitude - from.latitude) * Math.PI / 180;
  const longitudeDelta = (to.longitude - from.longitude) * Math.PI / 180;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(from.latitude * Math.PI / 180)
      * Math.cos(to.latitude * Math.PI / 180)
      * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function isBusinessAvailableAtLocation(business: Business, location: GeographicCoordinates): boolean {
  if (
    business.latitude == null
    || business.longitude == null
    || business.maxDeliveryDistanceM == null
    || !Number.isFinite(business.maxDeliveryDistanceM)
    || business.maxDeliveryDistanceM <= 0
  ) return false;

  const distanceM = distanceInKm(location, {
    latitude: business.latitude,
    longitude: business.longitude,
  }) * 1000;
  return distanceM <= business.maxDeliveryDistanceM;
}

export function filterBusinessesByLocation(businesses: Business[], location: GeographicCoordinates): Business[] {
  return businesses.filter((business) => isBusinessAvailableAtLocation(business, location));
}

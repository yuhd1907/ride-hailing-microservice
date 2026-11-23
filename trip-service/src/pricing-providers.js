'use strict';
const { distanceKm } = require('./fare');
const { fail } = require('./auth');

function createProviders({ env = process.env, request = fetch } = {}) {
  return {
    async route(pickup, destination, vehicleType, config) {
      if (!env.GOOGLE_ROUTES_API_KEY) {
        const distance = distanceKm(pickup, destination);
        return { distanceKm: distance, durationMinutes: distance / config.fallbackSpeedKph * 60, source: 'straight_line_estimate' };
      }
      try {
        const waypoint = point => ({ location: { latLng: { latitude: point.lat, longitude: point.lng } } });
        const response = await request('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST', signal: AbortSignal.timeout(3500),
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_ROUTES_API_KEY, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
          body: JSON.stringify({ origin: waypoint(pickup), destination: waypoint(destination), travelMode: vehicleType === 'MOTORCYCLE' ? 'TWO_WHEELER' : 'DRIVE', routingPreference: 'TRAFFIC_AWARE' }),
        });
        if (!response.ok) throw new Error('Routes request failed');
        const route = (await response.json()).routes?.[0];
        const seconds = typeof route?.duration === 'string' && /^\d+(?:\.\d+)?s$/.test(route.duration) ? Number(route.duration.slice(0, -1)) : NaN;
        if (!Number.isFinite(route?.distanceMeters) || route.distanceMeters < 0 || !Number.isFinite(seconds)) throw new Error('Invalid route');
        return { distanceKm: route.distanceMeters / 1000, durationMinutes: seconds / 60, source: 'google_routes_traffic' };
      } catch (_) {
        // A configured road provider must not silently change to a different fare basis.
        fail(503, 'Road route unavailable; please request a new quote');
      }
    },
    async weather(pickup) {
      if (!env.GOOGLE_WEATHER_API_KEY) return { raining: false, status: 'disabled' };
      try {
        const url = new URL('https://weather.googleapis.com/v1/currentConditions:lookup');
        url.searchParams.set('location.latitude', pickup.lat);
        url.searchParams.set('location.longitude', pickup.lng);
        const response = await request(url, { headers: { 'X-Goog-Api-Key': env.GOOGLE_WEATHER_API_KEY }, signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error('Weather request failed');
        const data = await response.json();
        const type = data.weatherCondition?.type;
        if (typeof type !== 'string' || type === 'TYPE_UNSPECIFIED') throw new Error('Invalid weather');
        // Only current rain codes, never CHANCE_OF_SHOWERS or a future forecast.
        const raining = /^(?:WIND_AND_RAIN|(?:LIGHT_|HEAVY_)?RAIN(?:_SHOWERS)?|LIGHT_TO_MODERATE_RAIN|MODERATE_TO_HEAVY_RAIN|RAIN_PERIODICALLY_HEAVY|SCATTERED_SHOWERS|THUNDERSHOWER|LIGHT_THUNDERSTORM_RAIN|SCATTERED_THUNDERSTORMS|HEAVY_THUNDERSTORM|THUNDERSTORM)$/.test(type);
        return { raining, status: 'available', condition: type };
      } catch (_) {
        return { raining: false, status: 'unavailable' };
      }
    },
  };
}
module.exports = { createProviders };

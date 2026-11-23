'use strict';
// Keep authorization/saga unit tests isolated from pricing infrastructure.
// Real pricing SQL, quote locks and HTTP flow are covered in dynamic-pricing.test.js.
const crypto = require('node:crypto');
const { distanceKm } = require('../../trip-service/src/fare');
module.exports = () => {
  const quotes = new Map();
  return {
    async quote(owner, body) {
      const snapshot = { ...body, quoteId: crypto.randomUUID(), estimatedDistance: Math.round(distanceKm(body.pickup, body.destination) * 100) / 100,
        estimatedDuration: 10, fareAmount: 48000, vehicleType: 'MOTORCYCLE', currency: 'VND' };
      quotes.set(snapshot.quoteId, snapshot);
      return snapshot;
    },
    async lockQuote(client, quoteId) { return { snapshot: quotes.get(quoteId) }; },
  };
};

'use strict';
const identity = require('./identity');
module.exports = (level, message, context = {}) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: identity.service, instanceId: identity.instanceId, correlationId: null, tripId: null, eventId: null, ...context, message }));

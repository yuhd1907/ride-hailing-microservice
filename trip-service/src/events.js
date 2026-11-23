'use strict';
const crypto = require('crypto');
const db = require('./db');
const rabbitmq = require('./rabbitmq');
const log = require('./logger');
async function transaction(work) {
  const client = await db.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function enqueue(client, eventType, payload, correlationId) {
  const event = { eventId: crypto.randomUUID(), eventType, correlationId, occurredAt: new Date().toISOString(), payload };
  await client.query('INSERT INTO event_outbox (event_id, envelope) VALUES ($1, $2)', [event.eventId, event]);
  return event;
}
async function once(event, work) {
  return transaction(async client => {
    const inserted = await client.query('INSERT INTO processed_events (event_id, event_type) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id', [event.eventId, event.eventType]);
    if (inserted.rowCount) return work(client);
    log('info', 'Duplicate event ignored', { correlationId: event.correlationId, eventId: event.eventId, tripId: event.payload.tripId });
  });
}
let flushing = false;
async function flush() {
  if (flushing || !rabbitmq.channel) return;
  flushing = true;
  try {
    await transaction(async client => {
      const { rows } = await client.query('SELECT event_id, envelope FROM event_outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED');
      for (const row of rows) {
        await rabbitmq.publishEnvelope(row.envelope);
        await client.query('UPDATE event_outbox SET published_at = CURRENT_TIMESTAMP WHERE event_id = $1', [row.event_id]);
      }
    });
  } catch (error) { log('error', `Outbox publish failed: ${error.message}`); }
  finally { flushing = false; }
}
async function initialize() {
  await db.query('ALTER TABLE trips ADD COLUMN IF NOT EXISTS "rejectedDriverIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[]');
  await db.query(`CREATE TABLE IF NOT EXISTS processed_events (event_id UUID PRIMARY KEY, event_type VARCHAR(100) NOT NULL, processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS event_outbox (event_id UUID PRIMARY KEY, envelope JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, published_at TIMESTAMPTZ);
    CREATE INDEX IF NOT EXISTS event_outbox_pending_idx ON event_outbox (created_at) WHERE published_at IS NULL;`);
}
module.exports = { transaction, enqueue, once, flush, initialize };

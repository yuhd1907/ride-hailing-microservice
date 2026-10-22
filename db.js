'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
  // Set PGSSL=true when connecting to a server that requires TLS.
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
});

pool.on('error', (error) => {
  // pg removes a failed idle client from the pool. Future pool requests create
  // replacement clients; handling the event prevents an unhandled error crash.
  console.error('[PostgreSQL] Idle client error; pool will replace it:', error.message);
});

async function connect({ retries = 5, initialDelayMs = 500 } = {}) {
  let delay = initialDelayMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
      console.info('[PostgreSQL] Connected');
      return;
    } catch (error) {
      console.error(`[PostgreSQL] Connection attempt ${attempt} failed:`, error.message);
      if (attempt > retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 10000);
    }
  }
}

function query(text, params) {
  // Pool handles replacement connections on subsequent queries. Avoid blindly
  // retrying statements here, since retrying a write could execute it twice.
  return pool.query(text, params);
}

async function close() {
  await pool.end();
  console.info('[PostgreSQL] Pool closed');
}

module.exports = { pool, connect, query, close };

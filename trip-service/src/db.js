'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      user: process.env.DB_USER, password: process.env.DB_PASS || process.env.DB_PASSWORD,
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5435),
      database: process.env.DB_NAME,
    });
pool.on('error', (error) => console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', correlationId: null, method: null, url: null, message: `PostgreSQL pool error: ${error.message}` })));
module.exports = pool;

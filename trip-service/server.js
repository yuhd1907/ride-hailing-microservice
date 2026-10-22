require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');

const app = express();
const port = Number(process.env.TRIP_SERVICE_PORT || process.env.PORT || 8083);
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
});
let channel;

async function connectRabbitMQ() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672');
  channel = await connection.createChannel();
  connection.on('close', () => { channel = null; });
  return connection;
}

app.get('/ping', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    if (!channel) throw new Error('RabbitMQ channel is not connected');
    await channel.assertQueue('trip-service.health', { durable: false });
    res.status(200).json({ status: 'UP', service: 'trip-service' });
  } catch (error) {
    res.status(500).json({ status: 'DOWN', error: error.message });
  }
});

const server = app.listen(port, () => console.log(`trip-service listening on ${port}`));
connectRabbitMQ().catch((error) => console.error('RabbitMQ connection failed:', error.message));

async function shutdown() {
  server.close();
  await pool.end();
  if (channel) await channel.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 50, // Soporta alta concurrencia sin agotar conexiones de PostgreSQL
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
module.exports = pool;
pool.on('error', (err) => {
  console.error('Error inesperado en la base de datos de inventario', err);
});

module.exports = pool;
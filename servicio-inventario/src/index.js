const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { obtenerCatalogo, reservarProducto, liberarProducto } = require('./controllers/inventario.controller');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.status(200).json({ status: 'UP', service: 'Inventario', db_time: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ status: 'DOWN', service: 'Inventario', error: error.message });
  }
});

// Rutas de negocio de Inventario
app.get('/api/inventario', obtenerCatalogo);
app.post('/api/inventario/reservar', reservarProducto);
app.post('/api/inventario/liberar', liberarProducto);

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Servicio de Inventario corriendo en el puerto ${PORT}`);
});
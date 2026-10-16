const express = require('express');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.status(200).json({ status: 'UP', service: 'Pedidos Orquestador', db_time: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ status: 'DOWN', error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
const { crearPedido } = require('./controllers/pedidos.controller');

app.post('/api/pedidos', crearPedido);
app.listen(PORT, () => {
  console.log(`Servicio de Pedidos corriendo en el puerto ${PORT}`);
});
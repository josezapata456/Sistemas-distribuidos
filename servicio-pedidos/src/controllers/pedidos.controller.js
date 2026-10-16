const pool = require('../db');
const axios = require('axios');

const crearPedido = async (req, res) => {
  const { cliente_id, sku, cantidad } = req.body;
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'El header Idempotency-Key es obligatorio' });
  }

  try {
    // 1. Verificación de Idempotencia
    const pedidoExistente = await pool.query(
      'SELECT * FROM pedidos WHERE idempotency_key = $1',
      [idempotencyKey]
    );

    if (pedidoExistente.rows.length > 0) {
      return res.status(200).json({
        mensaje: 'Pedido recuperado (Idempotente)',
        pedido: pedidoExistente.rows[0]
      });
    }

    // 2. Iniciar la Saga (Estado Local: PENDIENTE)
    const pedidoId = `PED-${Date.now()}`;
    await pool.query(
      'INSERT INTO pedidos (id, cliente_id, sku, cantidad, estado, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6)',
      [pedidoId, cliente_id, sku, cantidad, 'PENDIENTE', idempotencyKey]
    );

    // 3. Llamada Síncrona a Inventario con Timeout estricto de 2000ms
    try {
      await axios.post(`${process.env.INVENTARIO_URL}/api/inventario/reservar`, {
        pedido_id: pedidoId,
        sku,
        cantidad
      }, { timeout: 2000 });

      // 4a. Éxito: Avanzar Saga a RESERVADO
      const { rows } = await pool.query(
        'UPDATE pedidos SET estado = $1 WHERE id = $2 RETURNING *',
        ['RESERVADO', pedidoId]
      );

      return res.status(201).json({
        mensaje: 'Pedido creado y reserva confirmada',
        pedido: rows[0]
      });

    } catch (apiError) {
      // 4b. Fallo: Compensación Local (Cancelar Pedido)
      const errorMsg = apiError.response?.data?.error || apiError.message;
      
      await pool.query(
        'UPDATE pedidos SET estado = $1 WHERE id = $2',
        ['CANCELADO', pedidoId]
      );

      // Evaluar si fue un Timeout de red
      if (apiError.code === 'ECONNABORTED') {
         return res.status(503).json({ error: 'Timeout al contactar al inventario. Saga Cancelada.' });
      }

      return res.status(409).json({ error: `Fallo en inventario: ${errorMsg}. Saga Cancelada.` });
    }

  } catch (error) {
    console.error("Error en el orquestador:", error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = { crearPedido };
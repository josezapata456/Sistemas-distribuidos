const pool = require('../db');
const axios = require('axios');
const circuitBreaker = require('../utils/circuitBreaker');

const crearPedido = async (req, res) => {
  const { cliente_id, sku, cantidad, simular_fallo_pago } = req.body;
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'El header Idempotency-Key es obligatorio' });
  }

  try {
    // 1. Verificación de Idempotencia (RF-02 / RNF-04)
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

    // 2. Iniciar la Saga en estado PENDIENTE
    const pedidoId = `PED-${Date.now()}`;
    await pool.query(
      'INSERT INTO pedidos (id, cliente_id, sku, cantidad, estado, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6)',
      [pedidoId, cliente_id, sku, cantidad, 'PENDIENTE', idempotencyKey]
    );

    // 3. Paso 1 de la Saga: Reservar en Inventario protegido por Circuit Breaker y Timeout (2000ms)
    try {
      await circuitBreaker.ejecutarLlamada(() =>
        axios.post(`${process.env.INVENTARIO_URL}/api/inventario/reservar`, {
          pedido_id: pedidoId,
          sku,
          cantidad
        }, { timeout: 2000 })
      );

      await pool.query('UPDATE pedidos SET estado = $1 WHERE id = $2', ['RESERVADO', pedidoId]);

    } catch (apiError) {
      // Compensación local: Inventario rechazó (409) o está caído/Circuit Breaker abierto
      await pool.query('UPDATE pedidos SET estado = $1 WHERE id = $2', ['CANCELADO', pedidoId]);

      if (apiError.code === 'CIRCUIT_OPEN') {
        return res.status(503).json({
          error: apiError.message,
          circuit_breaker: circuitBreaker.obtenerEstado(),
          saga_estado: 'CANCELADO'
        });
      }

      if (apiError.code === 'ECONNABORTED' || apiError.code === 'ECONNREFUSED') {
        return res.status(503).json({
          error: 'Servicio de Inventario no disponible o Timeout (2000ms). Saga Cancelada.',
          circuit_breaker: circuitBreaker.obtenerEstado(),
          saga_estado: 'CANCELADO'
        });
      }

      const errorMsg = apiError.response?.data?.error || apiError.message;
      return res.status(409).json({
        error: `Fallo en inventario: ${errorMsg}. Saga Cancelada.`,
        saga_estado: 'CANCELADO'
      });
    }

    // 4. Paso 2 de la Saga: Validación de Pago / Confirmación (Con soporte para inyección de fallos)
    if (simular_fallo_pago === true) {
      // Transicionar a COMPENSANDO y revertir la reserva en Inventario (RF-04 / Regla 5)
      await pool.query('UPDATE pedidos SET estado = $1 WHERE id = $2', ['COMPENSANDO', pedidoId]);

      await axios.post(`${process.env.INVENTARIO_URL}/api/inventario/liberar`, {
        pedido_id: pedidoId,
        sku,
        cantidad
      }, { timeout: 2000 });

      const { rows } = await pool.query(
        'UPDATE pedidos SET estado = $1 WHERE id = $2 RETURNING *',
        ['CANCELADO', pedidoId]
      );

      return res.status(422).json({
        error: 'Pago rechazado. Se ejecutó compensación liberando el stock en Inventario.',
        pedido: rows[0]
      });
    }

    // 5. Cierre Exitoso de la Saga: Estado CONFIRMADO (Regla 4)
    const { rows } = await pool.query(
      'UPDATE pedidos SET estado = $1 WHERE id = $2 RETURNING *',
      ['CONFIRMADO', pedidoId]
    );

    return res.status(201).json({
      mensaje: 'Saga completada: Pedido CONFIRMADO y stock comprometido',
      pedido: rows[0]
    });

  } catch (error) {
    console.error("Error en el orquestador:", error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Endpoint para listar historial de pedidos y estado del Circuit Breaker
const listarPedidos = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pedidos ORDER BY creado_en DESC');
    res.status(200).json({
      circuit_breaker: circuitBreaker.obtenerEstado(),
      pedidos: rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { crearPedido, listarPedidos };
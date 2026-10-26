const pool = require('../db');
const axios = require('axios');
const circuitBreaker = require('../utils/circuitBreaker');
const { publicarEvento } = require('../utils/broker');

const crearPedido = async (req, res) => {
  const { cliente_id, sku, cantidad, simular_fallo_pago } = req.body;
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

    // 2. Iniciar la Saga en estado PENDIENTE (ID único a prueba de ráfagas en el mismo milisegundo)
    const timestamp = Date.now();
    const sufijoUnico = Math.random().toString(36).substring(2, 7).toUpperCase();
    const pedidoId = `PED-${timestamp}-${sufijoUnico}`;
    const traceId = `trc-${timestamp}-${sufijoUnico}`;

    try {
      await pool.query(
        'INSERT INTO pedidos (id, cliente_id, sku, cantidad, estado, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6)',
        [pedidoId, cliente_id, sku, cantidad, 'PENDIENTE', idempotencyKey]
      );
    } catch (insertErr) {
      // Si dos peticiones con la MISMA Idempotency-Key entraron en el mismo microsegundo:
      if (insertErr.code === '23505') {
        const { rows } = await pool.query('SELECT * FROM pedidos WHERE idempotency_key = $1', [idempotencyKey]);
        return res.status(200).json({
          mensaje: 'Pedido recuperado en colisión concurrente (Idempotente)',
          pedido: rows[0]
        });
      }
      throw insertErr;
    }

    // 3. Paso 1: Reservar en Inventario con Circuit Breaker y Timeout (2000ms)
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
      await pool.query('UPDATE pedidos SET estado = $1 WHERE id = $2', ['CANCELADO', pedidoId]);

      await publicarEvento({
        event_id: `evt-canc-${pedidoId}`,
        trace_id: traceId,
        pedido_id: pedidoId,
        cliente_id,
        sku,
        tipo_evento: 'PEDIDO_CANCELADO',
        estado: 'CANCELADO',
        motivo: apiError.response?.data?.error || apiError.message,
        timestamp: new Date().toISOString()
      });

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

    // 4. Paso 2: Validación de Pago / Compensación Remota
    if (simular_fallo_pago === true) {
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

      await publicarEvento({
        event_id: `evt-comp-${pedidoId}`,
        trace_id: traceId,
        pedido_id: pedidoId,
        cliente_id,
        sku,
        tipo_evento: 'PEDIDO_CANCELADO',
        estado: 'CANCELADO',
        motivo: 'PAGO_RECHAZADO_STOCK_LIBERADO',
        timestamp: new Date().toISOString()
      });

      return res.status(422).json({
        error: 'Pago rechazado. Se ejecutó compensación liberando el stock en Inventario.',
        pedido: rows[0]
      });
    }

    // 5. Cierre Exitoso: Estado CONFIRMADO + Publicación de Evento Asíncrono (RF-06)
    const { rows } = await pool.query(
      'UPDATE pedidos SET estado = $1 WHERE id = $2 RETURNING *',
      ['CONFIRMADO', pedidoId]
    );

    await publicarEvento({
      event_id: `evt-conf-${pedidoId}`,
      trace_id: traceId,
      pedido_id: pedidoId,
      cliente_id,
      sku,
      tipo_evento: 'PEDIDO_CONFIRMADO',
      estado: 'CONFIRMADO',
      motivo: 'COMPRA_EXITOSA',
      timestamp: new Date().toISOString()
    });

    return res.status(201).json({
      mensaje: 'Saga completada: Pedido CONFIRMADO y evento publicado en RabbitMQ',
      pedido: rows[0]
    });

  } catch (error) {
    console.error("Error en el orquestador:", error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

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
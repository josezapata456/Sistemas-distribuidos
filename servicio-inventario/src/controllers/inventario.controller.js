const pool = require('../db');

// RF-01: Consultar catálogo y stock disponible
const obtenerCatalogo = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM productos ORDER BY sku ASC');
    res.status(200).json(rows);
  } catch (error) {
    console.error("Error al consultar catálogo:", error);
    res.status(500).json({ error: error.message });
  }
};

// RF-03: Reserva atómica indivisible (Compare-And-Swap)
const reservarProducto = async (req, res) => {
  const { pedido_id, sku, cantidad } = req.body;
  const MAX_REINTENTOS_CAS = 5;

  try {
    for (let intento = 1; intento <= MAX_REINTENTOS_CAS; intento++) {
      const { rows } = await pool.query('SELECT disponible, version FROM productos WHERE sku = $1', [sku]);

      if (rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
      if (rows[0].disponible < cantidad) return res.status(409).json({ error: 'SIN_STOCK' });

      const versionActual = rows[0].version;

      const result = await pool.query(
        `UPDATE productos 
         SET disponible = disponible - $1, 
             reservado = reservado + $1, 
             version = version + 1 
         WHERE sku = $2 AND disponible >= $1 AND version = $3 
         RETURNING *`,
        [cantidad, sku, versionActual]
      );

      // Si logró actualizar la fila, la reserva fue exitosa
      if (result.rowCount > 0) {
        return res.status(200).json({
          mensaje: 'Reserva comprometida',
          intentos_cas: intento,
          pedido_id,
          producto: result.rows[0]
        });
      }
      // Si rowCount === 0, otro hilo modificó la versión en este mismo milisegundo; el bucle reintenta de inmediato
    }

    return res.status(409).json({ error: 'ALTA_CONTENCION_CAS_REINTENTE' });
  } catch (error) {
    console.error("Error detallado en reserva:", error);
    res.status(500).json({ error: error.message || error.toString() });
  }
};

// RF-04: Liberación compensatoria de stock reservado
const liberarProducto = async (req, res) => {
  const { pedido_id, sku, cantidad } = req.body;

  try {
    const result = await pool.query(
      `UPDATE productos 
       SET disponible = disponible + $1, 
           reservado = GREATEST(0, reservado - $1), 
           version = version + 1 
       WHERE sku = $2 AND reservado >= $1 
       RETURNING *`,
      [cantidad, sku]
    );

    if (result.rowCount === 0) {
      // Idempotencia: si ya estaba liberado o no había reserva, respondemos 200 sin romper la Saga
      return res.status(200).json({
        mensaje: 'Stock ya liberado previamente (Idempotente)',
        pedido_id
      });
    }

    res.status(200).json({
      mensaje: 'Reserva liberada por compensación de Saga',
      pedido_id,
      producto: result.rows[0]
    });

  } catch (error) {
    console.error("Error al liberar stock:", error);
    res.status(500).json({ error: error.message || error.toString() });
  }
};

module.exports = { obtenerCatalogo, reservarProducto, liberarProducto };
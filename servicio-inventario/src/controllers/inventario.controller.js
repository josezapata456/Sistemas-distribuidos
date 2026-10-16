const pool = require('../db');

const reservarProducto = async (req, res) => {
  const { pedido_id, sku, cantidad } = req.body;

  try {
    // 1. Consultar estado actual
    const { rows } = await pool.query('SELECT disponible, version FROM productos WHERE sku = $1', [sku]);
    
    if (rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    if (rows[0].disponible < cantidad) return res.status(409).json({ error: 'SIN_STOCK' });

    const versionActual = rows[0].version;

    // 2. Ejecutar Operación Atómica Indivisible (CAS)
    const result = await pool.query(
      `UPDATE productos 
       SET disponible = disponible - $1, 
           reservado = reservado + $1, 
           version = version + 1 
       WHERE sku = $2 AND disponible >= $1 AND version = $3 
       RETURNING *`,
      [cantidad, sku, versionActual]
    );

    // 3. Validar si otro proceso modificó el registro en los milisegundos intermedios
    if (result.rowCount === 0) {
        return res.status(409).json({ error: 'SIN_STOCK' });
    }

    res.status(200).json({ 
        mensaje: 'Reserva comprometida', 
        pedido_id,
        producto: result.rows[0] 
    });

} catch (error) {
    console.error("Error detallado en el backend:", error);
    res.status(500).json({ error: error.message || error.toString() });
  }
};

module.exports = { reservarProducto };
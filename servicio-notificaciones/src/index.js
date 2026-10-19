const express = require('express');
const cors = require('cors');
const amqp = require('amqplib');
const pool = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const QUEUE_NAME = 'eventos_pedidos';

// Iniciar el consumidor asíncrono de RabbitMQ (RF-07)
const iniciarConsumidor = async () => {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    channel.prefetch(1);

    console.log(`[Notificaciones] Escuchando eventos en la cola '${QUEUE_NAME}'...`);

    channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;

      const evento = JSON.parse(msg.content.toString());
      console.log(`[Notificaciones] Mensaje recibido: ${evento.event_id} (${evento.tipo_evento})`);

      try {
        // Deduplicación atómica (RNF-04): Si event_id ya existe, lanza error de clave duplicada
        await pool.query(
          `INSERT INTO mensajes_procesados (event_id, pedido_id, tipo_evento, estado_notificado, detalle)
           VALUES ($1, $2, $3, $4, $5)`,
          [evento.event_id, evento.pedido_id, evento.tipo_evento, evento.estado, evento.motivo]
        );

        console.log(`[Notificaciones] Notificación enviada al cliente '${evento.cliente_id}': Pedido ${evento.pedido_id} -> ${evento.estado}`);
        // Confirmación manual (ACK) a RabbitMQ recién después de guardar en BD
        channel.ack(msg);

      } catch (dbError) {
        if (dbError.code === '23505') {
          // Código 23505 en PostgreSQL = Unique Violation (Evento duplicado)
          console.warn(`[Deduplicación] El evento ${evento.event_id} ya fue procesado antes. Ignorando duplicado y enviando ACK.`);
          channel.ack(msg);
        } else {
          console.error('[Notificaciones] Error al procesar mensaje, se reencolará:', dbError.message);
          channel.nack(msg, false, true);
        }
      }
    }, { noAck: false });

  } catch (error) {
    console.error('[Notificaciones] Error conectando a RabbitMQ:', error.message);
  }
};

// Endpoint para consultar las notificaciones y auditoría procesadas
app.get('/api/notificaciones', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mensajes_procesados ORDER BY procesado_en DESC');
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', service: 'Notificaciones y Auditoría' });
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, async () => {
  console.log(`Servicio de Notificaciones corriendo en el puerto ${PORT}`);
  await iniciarConsumidor();
});
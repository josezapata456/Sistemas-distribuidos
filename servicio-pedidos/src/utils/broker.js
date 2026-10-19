const amqp = require('amqplib');
require('dotenv').config();

const QUEUE_NAME = 'eventos_pedidos';
let channel = null;

const conectarBroker = async () => {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://admin:secretpassword@localhost:5672');
    channel = await connection.createChannel();
    // Cola durable para que los mensajes sobrevivan si Notificaciones está apagado (Regla 6 / RNF-05)
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    console.log(`[RabbitMQ] Conectado y cola '${QUEUE_NAME}' lista.`);
  } catch (error) {
    console.error('[RabbitMQ] Error al conectar con el Broker:', error.message);
  }
};

const publicarEvento = async (evento) => {
  try {
    if (!channel) {
      await conectarBroker();
    }
    if (channel) {
      const payload = Buffer.from(JSON.stringify(evento));
      channel.sendToQueue(QUEUE_NAME, payload, { persistent: true });
      console.log(`[RabbitMQ] Evento publicado -> ${evento.tipo_evento} (${evento.event_id})`);
    }
  } catch (error) {
    // Regla 6: Un fallo de notificación/broker no cancela una compra ya confirmada
    console.error('[RabbitMQ] No se pudo publicar el evento (el pedido conserva su estado):', error.message);
  }
};

module.exports = { conectarBroker, publicarEvento, QUEUE_NAME };
const URL_PEDIDOS = 'http://localhost:3001/api/pedidos';
const URL_INVENTARIO = 'http://localhost:3002/api/inventario';
const URL_NOTIFICACIONES = 'http://localhost:3003/api/notificaciones';

// Modo: 'RAFAGA_LOTES' (envía de 10 en 10 concurrentes) o 'MASIVO_PURO' (las 100 al mismo instante)
const TAMANO_LOTE_CONCURRENTE = 10; 

const generar100Peticiones = () => {
  const loteId = Date.now();
  const peticiones = [];

  // 1. 60 Peticiones normales con llaves únicas
  for (let i = 1; i <= 60; i++) {
    peticiones.push({
      numero: i,
      tipo: 'NORMAL_NUEVA',
      key: `STRESS-${loteId}-KEY-${i}`,
      body: { cliente_id: `Cliente_${i}`, sku: 'KIT-001', cantidad: 1, simular_fallo_pago: false }
    });
  }

  // 2. 25 Peticiones REPETIDAS (usan las mismas llaves de las primeras 25 peticiones)
  for (let i = 1; i <= 25; i++) {
    peticiones.push({
      numero: 60 + i,
      tipo: 'REPETIDA_IDEMPOTENTE',
      key: `STRESS-${loteId}-KEY-${i}`, // <- MISMA KEY A PROPÓSITO
      body: { cliente_id: `Cliente_${i}`, sku: 'KIT-001', cantidad: 1, simular_fallo_pago: false }
    });
  }

  // 3. 15 Peticiones con FALLO DE PAGO (disparan reserva + compensación remota liberando stock)
  for (let i = 1; i <= 15; i++) {
    peticiones.push({
      numero: 85 + i,
      tipo: 'FALLO_PAGO_COMPENSACION',
      key: `STRESS-${loteId}-COMP-${i}`,
      body: { cliente_id: `Cliente_Comp_${i}`, sku: 'KIT-001', cantidad: 1, simular_fallo_pago: true }
    });
  }

  return peticiones;
};

const dispararPeticion = async (item) => {
  const inicio = Date.now();
  try {
    const res = await fetch(URL_PEDIDOS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': item.key
      },
      body: JSON.stringify(item.body)
    });
    const data = await res.json();
    return {
      numero: item.numero,
      tipo: item.tipo,
      status: res.status,
      latenciaMs: Date.now() - inicio,
      mensaje: data.mensaje || data.error
    };
  } catch (err) {
    return {
      numero: item.numero,
      tipo: item.tipo,
      status: 'ERROR_RED',
      latenciaMs: Date.now() - inicio,
      mensaje: err.message
    };
  }
};

const ejecutarPrueba100 = async () => {
  console.log('==============================================================');
  console.log(' INICIANDO PRUEBA DE ESTRÉS DISTRIBUIDA (100 PETICIONES)');
  console.log('==============================================================');

  const invInicial = await (await fetch(URL_INVENTARIO)).json();
  console.log('Stock Inicial en db_inventario:', invInicial[0]);

  const lista100 = generar100Peticiones();
  const resultados = [];
  const tiempoInicioTotal = Date.now();

  // Ejecutamos en ráfagas concurrentes
  for (let i = 0; i < lista100.length; i += TAMANO_LOTE_CONCURRENTE) {
    const subLote = lista100.slice(i, i + TAMANO_LOTE_CONCURRENTE);
    const resSubLote = await Promise.all(subLote.map(dispararPeticion));
    resultados.push(...resSubLote);
    process.stdout.write(`Procesadas: ${resultados.length}/100...\r`);
  }

  const tiempoTotalMs = Date.now() - tiempoInicioTotal;

  // Contabilizar códigos HTTP
  const conteoStatus = {};
  resultados.forEach((r) => {
    conteoStatus[r.status] = (conteoStatus[r.status] || 0) + 1;
  });

  // Esperar 1 segundo para que RabbitMQ termine de vaciar la cola asíncrona
  await new Promise((r) => setTimeout(r, 1000));

  const invFinal = await (await fetch(URL_INVENTARIO)).json();
  const notifFinal = await (await fetch(URL_NOTIFICACIONES)).json();

  console.log('\n\n================ RESUMEN DE RESULTADOS ================');
  console.log(`Tiempo Total para 100 peticiones: ${tiempoTotalMs} ms`);
  console.log('\nDesglose por Código HTTP:');
  console.table(conteoStatus);

  console.log('Significado de los resultados:');
  console.log('- 201 (Created)             : Compras nuevas CONFIRMADAS y descontadas de inventario.');
  console.log('- 200 (OK - Idempotente)    : Peticiones con Key repetida bloqueadas sin duplicar cobro ni stock.');
  console.log('- 422 (Unprocessable)       : Fallos de pago que reservaron y luego LIBERARON stock por Saga.');
  console.log('- 409 (Conflict / CAS)      : Colisiones concurrentes de versión CAS o stock agotado (0 errores 500).');

  console.log('\nEstado Final en db_inventario (:3002):', invFinal[0]);
  console.log(`Total Eventos Procesados en RabbitMQ (:3003): ${notifFinal.length}`);
  console.log('==============================================================');
};

ejecutarPrueba100();
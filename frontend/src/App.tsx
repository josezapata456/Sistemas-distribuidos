import { useState, useEffect } from 'react';
import axios from 'axios';

interface Producto {
  sku: string;
  disponible: number;
  reservado: number;
  version: number;
}

interface Pedido {
  id: string;
  cliente_id: string;
  sku: string;
  cantidad: number;
  estado: string;
  idempotency_key: string;
  creado_en: string;
}

interface Notificacion {
  event_id: string;
  pedido_id: string;
  tipo_evento: string;
  estado_notificado: string;
  detalle: string;
  procesado_en: string;
}

interface ResumenEstres {
  total: number;
  tiempoMs: number;
  codigos: Record<string, number>;
  stockInicial?: Producto;
  stockFinal?: Producto;
}

function App() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [circuitBreaker, setCircuitBreaker] = useState({
    estado: 'CLOSED',
    fallosConsecutivos: 0,
    umbralFallos: 3,
  });

  const [cliente, setCliente] = useState('Ana');
  const [idempotencyKey, setIdempotencyKey] = useState(`KEY-${Date.now()}`);
  const [simularFalloPago, setSimularFalloPago] = useState(false);
  const [respuestaUltimaOperacion, setRespuestaUltimaOperacion] = useState<any>(null);
  const [cargando, setCargando] = useState(false);

  // Estados para la prueba de estrés de 100 peticiones en el Frontend
  const [progresoEstres, setProgresoEstres] = useState<number>(0);
  const [resumenEstres, setResumenEstres] = useState<ResumenEstres | null>(null);

  const cargarEstadoGlobal = async () => {
    try {
      const resInv = await axios.get('http://localhost:3002/api/inventario');
      setProductos(resInv.data);
    } catch {
      setProductos([]);
    }

    try {
      const resPed = await axios.get('http://localhost:3001/api/pedidos');
      setPedidos(resPed.data.pedidos || []);
      if (resPed.data.circuit_breaker) setCircuitBreaker(resPed.data.circuit_breaker);
    } catch (e) {
      console.error(e);
    }

    try {
      const resNotif = await axios.get('http://localhost:3003/api/notificaciones');
      setNotificaciones(resNotif.data || []);
    } catch {
      setNotificaciones([]);
    }
  };

  useEffect(() => {
    cargarEstadoGlobal();
    const interval = setInterval(cargarEstadoGlobal, 2500);
    return () => clearInterval(interval);
  }, []);

  const generarNuevaKey = () => {
    setIdempotencyKey(`KEY-${cliente.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  const cambiarStock = async (cantidad: number) => {
    await axios.post('http://localhost:3002/api/inventario/reset', { cantidad });
    cargarEstadoGlobal();
  };

  const enviarPedido = async (clienteOverride?: string, keyOverride?: string) => {
    setCargando(true);
    const clienteFinal = clienteOverride || cliente;
    const keyFinal = keyOverride || idempotencyKey;

    try {
      const res = await axios.post(
        'http://localhost:3001/api/pedidos',
        {
          cliente_id: clienteFinal,
          sku: 'KIT-001',
          cantidad: 1,
          simular_fallo_pago: simularFalloPago,
        },
        {
          headers: { 'Idempotency-Key': keyFinal },
        }
      );
      setRespuestaUltimaOperacion({ status: res.status, data: res.data });
    } catch (err: any) {
      setRespuestaUltimaOperacion({
        status: err.response?.status || 500,
        data: err.response?.data || { error: err.message },
      });
    } finally {
      setCargando(false);
      setTimeout(cargarEstadoGlobal, 300);
    }
  };

  // Simulación 1: Disputa simultánea Ana vs Bruno por la última unidad
  const simularDisputaSimultanea = async () => {
    setCargando(true);
    setResumenEstres(null);
    const sufijo = Date.now();
    const keyAna = `KEY-ANA-${sufijo}`;
    const keyBruno = `KEY-BRUNO-${sufijo}`;

    const promesas = [
      axios
        .post(
          'http://localhost:3001/api/pedidos',
          { cliente_id: 'Ana', sku: 'KIT-001', cantidad: 1, simular_fallo_pago: false },
          { headers: { 'Idempotency-Key': keyAna } }
        )
        .then((r) => ({ cliente: 'Ana', status: r.status, data: r.data }))
        .catch((e) => ({ cliente: 'Ana', status: e.response?.status, data: e.response?.data })),

      axios
        .post(
          'http://localhost:3001/api/pedidos',
          { cliente_id: 'Bruno', sku: 'KIT-001', cantidad: 1, simular_fallo_pago: false },
          { headers: { 'Idempotency-Key': keyBruno } }
        )
        .then((r) => ({ cliente: 'Bruno', status: r.status, data: r.data }))
        .catch((e) => ({ cliente: 'Bruno', status: e.response?.status, data: e.response?.data })),
    ];

    const resultados = await Promise.all(promesas);
    setRespuestaUltimaOperacion({ simulacion: 'Disputa Simultánea Ana vs Bruno', resultados });
    setCargando(false);
    setTimeout(cargarEstadoGlobal, 300);
  };

  // Simulación 2: Ráfaga de 100 Peticiones (60 nuevas + 25 repetidas idempotentes + 15 fallos de pago)
  const ejecutarEstres100 = async () => {
    setCargando(true);
    setProgresoEstres(0);
    setResumenEstres(null);

    const invInicialRes = await axios.get('http://localhost:3002/api/inventario');
    const stockInicial = invInicialRes.data[0];

    const loteId = Date.now();
    const lista: Array<{ key: string; body: any }> = [];

    // 60 Peticiones normales nuevas
    for (let i = 1; i <= 60; i++) {
      lista.push({
        key: `WEB-STRESS-${loteId}-KEY-${i}`,
        body: { cliente_id: `Cliente_${i}`, sku: 'KIT-001', cantidad: 1, simular_fallo_pago: false },
      });
    }
    // 25 Peticiones REPETIDAS (mismas llaves de las primeras 25)
    for (let i = 1; i <= 25; i++) {
      lista.push({
        key: `WEB-STRESS-${loteId}-KEY-${i}`,
        body: { cliente_id: `Cliente_${i}`, sku: 'KIT-001', cantidad: 1, simular_fallo_pago: false },
      });
    }
    // 15 Peticiones con fallo de pago y compensación remota de Saga
    for (let i = 1; i <= 15; i++) {
      lista.push({
        key: `WEB-STRESS-${loteId}-COMP-${i}`,
        body: { cliente_id: `Cliente_Comp_${i}`, sku: 'KIT-001', cantidad: 1, simular_fallo_pago: true },
      });
    }

    const conteoCodigos: Record<string, number> = {};
    const inicioMs = performance.now();
    const TAMANO_LOTE = 10;

    for (let i = 0; i < lista.length; i += TAMANO_LOTE) {
      const subLote = lista.slice(i, i + TAMANO_LOTE);
      const respuestas = await Promise.all(
        subLote.map((item) =>
          axios
            .post('http://localhost:3001/api/pedidos', item.body, {
              headers: { 'Idempotency-Key': item.key },
            })
            .then((r) => r.status)
            .catch((e) => e.response?.status || 500)
        )
      );

      respuestas.forEach((code) => {
        const k = String(code);
        conteoCodigos[k] = (conteoCodigos[k] || 0) + 1;
      });

      setProgresoEstres(Math.min(100, i + subLote.length));
    }

    const tiempoTotalMs = Math.round(performance.now() - inicioMs);
    await new Promise((r) => setTimeout(r, 500));
    const invFinalRes = await axios.get('http://localhost:3002/api/inventario');

    setResumenEstres({
      total: 100,
      tiempoMs: tiempoTotalMs,
      codigos: conteoCodigos,
      stockInicial,
      stockFinal: invFinalRes.data[0],
    });

    setCargando(false);
    cargarEstadoGlobal();
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Encabezado */}
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-slate-800 p-5 rounded-xl border border-slate-700 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Sistema de Pedidos Distribuido</h1>
          <p className="text-sm text-slate-400">
            Microservicios • Orquestador Saga • Reintentos CAS (Pool 50) • RabbitMQ Asíncrono
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs">
            <span className="text-slate-400 mr-2">Circuit Breaker:</span>
            <span
              className={`font-bold px-2 py-0.5 rounded ${
                circuitBreaker.estado === 'CLOSED'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : circuitBreaker.estado === 'OPEN'
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-amber-500/20 text-amber-400'
              }`}
            >
              {circuitBreaker.estado} ({circuitBreaker.fallosConsecutivos}/{circuitBreaker.umbralFallos})
            </span>
          </div>
          <button
            onClick={() => cambiarStock(1)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-2 rounded-lg transition"
          >
            Fijar Stock = 1 (Disputa)
          </button>
          <button
            onClick={() => cambiarStock(1000)}
            className="bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium px-3 py-2 rounded-lg transition"
          >
            Fijar Stock = 1000 (Estrés)
          </button>
        </div>
      </header>

      {/* Fila Superior: Inventario + Simulador de Saga y Estrés */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tarjeta de Inventario (:3002) */}
        <div className="bg-slate-800 p-5 rounded-xl border border-slate-700">
          <h2 className="text-lg font-semibold text-emerald-400 mb-2">
            1. Servicio de Inventario (:3002)
          </h2>
          <p className="text-xs text-slate-400 mb-4">
            BD Aislada: db_inventario (CAS con Reintentos Automáticos)
          </p>
          {productos.length === 0 ? (
            <div className="p-4 bg-red-950/40 border border-red-800 rounded-lg text-red-300 text-sm">
              Servicio de Inventario Inalcanzable (:3002 apagado)
            </div>
          ) : (
            productos.map((p) => (
              <div key={p.sku} className="bg-slate-900 p-4 rounded-lg border border-slate-700 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-lg">{p.sku}</span>
                  <span className="text-xs bg-slate-800 px-2.5 py-1 rounded text-emerald-300 border border-slate-700">
                    Versión CAS: <strong>v{p.version}</strong>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-800 p-3 rounded text-center">
                    <span className="block text-xs text-slate-400">Disponible</span>
                    <span className={`text-2xl font-bold ${p.disponible > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {p.disponible}
                    </span>
                  </div>
                  <div className="bg-slate-800 p-3 rounded text-center">
                    <span className="block text-xs text-slate-400">Reservado / Vendido</span>
                    <span className="text-2xl font-bold text-amber-400">{p.reservado}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Formulario Orquestador (:3001) */}
        <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold text-sky-400">
            2. Orquestador de Pedidos y Pruebas de Carga (:3001)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Cliente</label>
              <select
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm"
              >
                <option value="Ana">Ana</option>
                <option value="Bruno">Bruno</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Header: Idempotency-Key (Evita cobros/pedidos dobles)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={idempotencyKey}
                  onChange={(e) => setIdempotencyKey(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono"
                />
                <button
                  onClick={generarNuevaKey}
                  className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-xs whitespace-nowrap"
                >
                  Nueva Key
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-900 p-3 rounded-lg border border-slate-700">
            <input
              type="checkbox"
              id="falloPago"
              checked={simularFalloPago}
              onChange={(e) => setSimularFalloPago(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="falloPago" className="text-sm text-slate-300 cursor-pointer">
              <strong>Inyectar Fallo de Pago</strong> (Reserva en Inventario, falla el cobro y ejecuta{' '}
              <span className="text-amber-400">Compensación liberando stock</span>)
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              disabled={cargando}
              onClick={() => enviarPedido()}
              className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-xs transition"
            >
              Enviar Pedido Individual
            </button>
            <button
              disabled={cargando}
              onClick={simularDisputaSimultanea}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-xs transition"
            >
              Disputa Simultánea (Ana vs Bruno)
            </button>
            <button
              disabled={cargando}
              onClick={ejecutarEstres100}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-xs transition"
            >
              Lanzar Ráfaga de 100 Peticiones (60 Nuevas + 25 Repetidas + 15 Compensadas)
            </button>
          </div>

          {/* Barra de progreso y resultados de la prueba de 100 peticiones */}
          {progresoEstres > 0 && progresoEstres < 100 && (
            <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 text-xs">
              Procesando ráfaga distribuida: <strong>{progresoEstres} / 100</strong> peticiones...
            </div>
          )}

          {resumenEstres && (
            <div className="bg-slate-950 p-4 rounded-lg border border-amber-500/40 space-y-3 text-xs">
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <span className="font-bold text-amber-400">
                  Resultado Prueba de Estrés (100 Peticiones en {resumenEstres.tiempoMs} ms)
                </span>
                <span className="text-slate-400">
                  Versión CAS: v{resumenEstres.stockInicial?.version} → v{resumenEstres.stockFinal?.version}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                <div className="bg-slate-900 p-2 rounded border border-slate-800">
                  <span className="block text-emerald-400 font-bold text-lg">
                    {resumenEstres.codigos['201'] || 0}
                  </span>
                  <span className="text-slate-400">201 Confirmados</span>
                </div>
                <div className="bg-slate-900 p-2 rounded border border-slate-800">
                  <span className="block text-sky-400 font-bold text-lg">
                    {resumenEstres.codigos['200'] || 0}
                  </span>
                  <span className="text-slate-400">200 Idempotentes</span>
                </div>
                <div className="bg-slate-900 p-2 rounded border border-slate-800">
                  <span className="block text-amber-400 font-bold text-lg">
                    {resumenEstres.codigos['422'] || 0}
                  </span>
                  <span className="text-slate-400">422 Compensados</span>
                </div>
                <div className="bg-slate-900 p-2 rounded border border-slate-800">
                  <span className="block text-red-400 font-bold text-lg">
                    {resumenEstres.codigos['409'] || 0}
                  </span>
                  <span className="text-slate-400">409 Conflicto / Stock</span>
                </div>
              </div>
            </div>
          )}

          {/* Consola de respuesta individual */}
          {respuestaUltimaOperacion && !resumenEstres && (
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs font-mono overflow-x-auto max-h-44">
              <div className="text-slate-400 mb-1">Respuesta HTTP del Orquestador:</div>
              <pre className="text-emerald-300">{JSON.stringify(respuestaUltimaOperacion, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>

      {/* Fila Inferior: Tabla de Pedidos (db_pedidos) y Eventos RabbitMQ (:3003) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800 p-5 rounded-xl border border-slate-700">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold text-white">
              Historial de Sagas en db_pedidos (:3001)
            </h2>
            <span className="text-xs bg-slate-900 px-2.5 py-1 rounded text-slate-300 border border-slate-700">
              Total registros: <strong>{pedidos.length}</strong>
            </span>
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="py-2">Pedido ID</th>
                  <th>Cliente</th>
                  <th>Estado Saga</th>
                  <th>Idempotency Key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {pedidos.slice(0, 50).map((ped) => (
                  <tr key={ped.id}>
                    <td className="py-2 font-mono">{ped.id}</td>
                    <td className="font-semibold">{ped.cliente_id}</td>
                    <td>
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          ped.estado === 'CONFIRMADO'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : ped.estado === 'CANCELADO'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-amber-500/20 text-amber-400'
                        }`}
                      >
                        {ped.estado}
                      </span>
                    </td>
                    <td className="font-mono text-slate-400">{ped.idempotency_key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-800 p-5 rounded-xl border border-slate-700">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-lg font-semibold text-amber-400">
              3. Notificaciones vía RabbitMQ (:3003)
            </h2>
            <span className="text-xs bg-slate-900 px-2.5 py-1 rounded text-amber-300 border border-slate-700">
              Eventos deduplicados: <strong>{notificaciones.length}</strong>
            </span>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Tabla: mensajes_procesados (Deduplicación Atómica + ACK Manual)
          </p>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="py-2">Event ID</th>
                  <th>Evento</th>
                  <th>Detalle / Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {notificaciones.slice(0, 50).map((n) => (
                  <tr key={n.event_id}>
                    <td className="py-2 font-mono text-slate-300">{n.event_id}</td>
                    <td>
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          n.tipo_evento === 'PEDIDO_CONFIRMADO'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {n.tipo_evento}
                      </span>
                    </td>
                    <td className="text-slate-400">{n.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
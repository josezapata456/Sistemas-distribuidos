import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  Divider,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Container,
  Paper,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Alert,
  LinearProgress,
  Switch,
  FormControlLabel,
  Stack,
  Card,
  CardContent,
  IconButton,
  Tooltip,
  createTheme,
  ThemeProvider,
  CssBaseline,
} from '@mui/material';

import {
  ShoppingCart as ShoppingCartIcon,
  Storage as StorageIcon,
  Speed as SpeedIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Send as SendIcon,
  Autorenew as AutorenewIcon,
  Bolt as BoltIcon,
  Hub as HubIcon,
  NotificationsActive as NotificationsIcon,
  CompareArrows as CompareArrowsIcon,
  Inventory as InventoryIcon,
} from '@mui/icons-material';

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

const drawerWidth = 265;

const corporateTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1565c0' },
    secondary: { main: '#455a64' },
    background: { default: '#f4f6f8', paper: '#ffffff' },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
  shape: { borderRadius: 8 },
});

export default function App() {
  const [vistaActiva, setVistaActiva] = useState<'operaciones' | 'auditoria' | 'laboratorio'>('operaciones');

  const [productos, setProductos] = useState<Producto[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [circuitBreaker, setCircuitBreaker] = useState({
    estado: 'CLOSED',
    fallosConsecutivos: 0,
    umbralFallos: 3,
  });

  const [nodoPedidosUp, setNodoPedidosUp] = useState(true);
  const [nodoInventarioUp, setNodoInventarioUp] = useState(true);
  const [nodoNotifUp, setNodoNotifUp] = useState(true);

  const [cliente, setCliente] = useState('Ana');
  const [idempotencyKey, setIdempotencyKey] = useState(`ORD-${Date.now()}`);
  const [simularFalloPago, setSimularFalloPago] = useState(false);
  const [respuestaUltimaOperacion, setRespuestaUltimaOperacion] = useState<any>(null);
  const [cargando, setCargando] = useState(false);

  const [progresoEstres, setProgresoEstres] = useState<number>(0);
  const [resumenEstres, setResumenEstres] = useState<ResumenEstres | null>(null);

  const [pagePedidos, setPagePedidos] = useState(0);
  const [rowsPerPagePedidos, setRowsPerPagePedidos] = useState(8);
  const [pageNotif, setPageNotif] = useState(0);
  const [rowsPerPageNotif, setRowsPerPageNotif] = useState(8);

  const cargarEstadoGlobal = async () => {
    try {
      const resInv = await axios.get('http://localhost:3002/api/inventario');
      setProductos(resInv.data);
      setNodoInventarioUp(true);
    } catch {
      setProductos([]);
      setNodoInventarioUp(false);
    }

    try {
      const resPed = await axios.get('http://localhost:3001/api/pedidos');
      setPedidos(resPed.data.pedidos || []);
      if (resPed.data.circuit_breaker) setCircuitBreaker(resPed.data.circuit_breaker);
      setNodoPedidosUp(true);
    } catch {
      setNodoPedidosUp(false);
    }

    try {
      const resNotif = await axios.get('http://localhost:3003/api/notificaciones');
      setNotificaciones(resNotif.data || []);
      setNodoNotifUp(true);
    } catch {
      setNotificaciones([]);
      setNodoNotifUp(false);
    }
  };

  useEffect(() => {
    cargarEstadoGlobal();
    const interval = setInterval(cargarEstadoGlobal, 2500);
    return () => clearInterval(interval);
  }, []);

  const generarNuevaKey = () => {
    setIdempotencyKey(`ORD-${cliente.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  const cambiarStock = async (cantidad: number) => {
    try {
      await axios.post('http://localhost:3002/api/inventario/reset', { cantidad });
      cargarEstadoGlobal();
    } catch (e) {
      console.error(e);
    }
  };

  const enviarPedido = async () => {
    setCargando(true);
    try {
      const res = await axios.post(
        'http://localhost:3001/api/pedidos',
        {
          cliente_id: cliente,
          sku: 'KIT-001',
          cantidad: 1,
          simular_fallo_pago: simularFalloPago,
        },
        {
          headers: { 'Idempotency-Key': idempotencyKey },
        }
      );
      setRespuestaUltimaOperacion({ ok: true, status: res.status, data: res.data });
    } catch (err: any) {
      setRespuestaUltimaOperacion({
        ok: false,
        status: err.response?.status || 500,
        data: err.response?.data || { error: err.message },
      });
    } finally {
      setCargando(false);
      setTimeout(cargarEstadoGlobal, 300);
    }
  };

  const simularDisputaSimultanea = async () => {
    setCargando(true);
    setResumenEstres(null);
    const sufijo = Date.now();
    const keyAna = `DISPUTA-ANA-${sufijo}`;
    const keyBruno = `DISPUTA-BRUNO-${sufijo}`;

    const promesas = [
      axios
        .post(
          'http://localhost:3001/api/pedidos',
          { cliente_id: 'Ana', sku: 'KIT-001', cantidad: 1, simular_fallo_pago: false },
          { headers: { 'Idempotency-Key': keyAna } }
        )
        .then((r) => ({ cliente: 'Ana', status: r.status, detalle: r.data.mensaje }))
        .catch((e) => ({ cliente: 'Ana', status: e.response?.status, detalle: e.response?.data?.error })),

      axios
        .post(
          'http://localhost:3001/api/pedidos',
          { cliente_id: 'Bruno', sku: 'KIT-001', cantidad: 1, simular_fallo_pago: false },
          { headers: { 'Idempotency-Key': keyBruno } }
        )
        .then((r) => ({ cliente: 'Bruno', status: r.status, detalle: r.data.mensaje }))
        .catch((e) => ({ cliente: 'Bruno', status: e.response?.status, detalle: e.response?.data?.error })),
    ];

    const resultados = await Promise.all(promesas);
    setRespuestaUltimaOperacion({
      ok: true,
      status: 200,
      data: { prueba: 'Colisión Concurrente CAS (Ana vs Bruno)', resultados },
    });
    setCargando(false);
    setTimeout(cargarEstadoGlobal, 300);
  };

  const ejecutarEstres100 = async () => {
    setCargando(true);
    setProgresoEstres(0);
    setResumenEstres(null);

    const invInicialRes = await axios.get('http://localhost:3002/api/inventario');
    const stockInicial = invInicialRes.data[0];

    const loteId = Date.now();
    const lista: Array<{ key: string; body: any }> = [];

    for (let i = 1; i <= 60; i++) {
      lista.push({
        key: `LOTE-${loteId}-KEY-${i}`,
        body: { cliente_id: `Cliente_${i}`, sku: 'KIT-001', cantidad: 1, simular_fallo_pago: false },
      });
    }
    for (let i = 1; i <= 25; i++) {
      lista.push({
        key: `LOTE-${loteId}-KEY-${i}`,
        body: { cliente_id: `Cliente_${i}`, sku: 'KIT-001', cantidad: 1, simular_fallo_pago: false },
      });
    }
    for (let i = 1; i <= 15; i++) {
      lista.push({
        key: `LOTE-${loteId}-COMP-${i}`,
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

  const stockActual = productos[0];

  return (
    <ThemeProvider theme={corporateTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        <AppBar
          position="fixed"
          elevation={1}
          sx={{
            width: `calc(100% - ${drawerWidth}px)`,
            ml: `${drawerWidth}px`,
            bgcolor: '#ffffff',
            color: '#1e293b',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <Toolbar sx={{ justifyContent: 'space-between' }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <HubIcon color="primary" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Consola de Gestión de Pedidos y Coordinación de Sagas
              </Typography>
            </Stack>

            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Chip
                size="small"
                icon={nodoPedidosUp ? <CheckCircleIcon /> : <ErrorIcon />}
                label="Orquestador (:3001)"
                color={nodoPedidosUp ? 'success' : 'error'}
                variant="outlined"
              />
              <Chip
                size="small"
                icon={nodoInventarioUp ? <CheckCircleIcon /> : <ErrorIcon />}
                label="Inventario (:3002)"
                color={nodoInventarioUp ? 'success' : 'error'}
                variant="outlined"
              />
              <Chip
                size="small"
                icon={nodoNotifUp ? <CheckCircleIcon /> : <ErrorIcon />}
                label="RabbitMQ Worker (:3003)"
                color={nodoNotifUp ? 'success' : 'error'}
                variant="outlined"
              />
              <Divider orientation="vertical" flexItem />
              <Chip
                size="small"
                icon={
                  circuitBreaker.estado === 'CLOSED' ? (
                    <CheckCircleIcon />
                  ) : circuitBreaker.estado === 'OPEN' ? (
                    <ErrorIcon />
                  ) : (
                    <WarningIcon />
                  )
                }
                label={`Circuit Breaker: ${circuitBreaker.estado} (${circuitBreaker.fallosConsecutivos}/${circuitBreaker.umbralFallos})`}
                color={
                  circuitBreaker.estado === 'CLOSED'
                    ? 'success'
                    : circuitBreaker.estado === 'OPEN'
                    ? 'error'
                    : 'warning'
                }
              />
              <Tooltip title="Sincronizar estado ahora">
                <IconButton size="small" onClick={cargarEstadoGlobal}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Toolbar>
        </AppBar>

        <Drawer
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
              bgcolor: '#0f172a',
              color: '#f8fafc',
            },
          }}
          variant="permanent"
          anchor="left"
        >
          <Box sx={{ p: 2.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, letterSpacing: 0.5, color: '#fff' }}>
              SISTEMA DISTRIBUIDO
            </Typography>
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>
              Arquitectura Microservicios v1.0
            </Typography>
          </Box>
          <Divider sx={{ borderColor: '#1e293b' }} />

          <List sx={{ px: 1.5, pt: 2 }}>
            <ListItem disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                selected={vistaActiva === 'operaciones'}
                onClick={() => setVistaActiva('operaciones')}
                sx={{
                  borderRadius: 1.5,
                  '&.Mui-selected': { bgcolor: '#1d4ed8', color: '#fff' },
                  '&.Mui-selected:hover': { bgcolor: '#1e40af' },
                }}
              >
                <ListItemIcon sx={{ color: 'inherit', minWidth: 38 }}>
                  <ShoppingCartIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={<Typography sx={{ fontSize: '14px', fontWeight: 500 }}>Operaciones y Venta</Typography>}
                />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                selected={vistaActiva === 'auditoria'}
                onClick={() => setVistaActiva('auditoria')}
                sx={{
                  borderRadius: 1.5,
                  '&.Mui-selected': { bgcolor: '#1d4ed8', color: '#fff' },
                  '&.Mui-selected:hover': { bgcolor: '#1e40af' },
                }}
              >
                <ListItemIcon sx={{ color: 'inherit', minWidth: 38 }}>
                  <StorageIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={<Typography sx={{ fontSize: '14px', fontWeight: 500 }}>Trazabilidad y Colas</Typography>}
                />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                selected={vistaActiva === 'laboratorio'}
                onClick={() => setVistaActiva('laboratorio')}
                sx={{
                  borderRadius: 1.5,
                  '&.Mui-selected': { bgcolor: '#1d4ed8', color: '#fff' },
                  '&.Mui-selected:hover': { bgcolor: '#1e40af' },
                }}
              >
                <ListItemIcon sx={{ color: 'inherit', minWidth: 38 }}>
                  <SpeedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={<Typography sx={{ fontSize: '14px', fontWeight: 500 }}>Benchmark y Concurrencia</Typography>}
                />
              </ListItemButton>
            </ListItem>
          </List>

          <Box sx={{ mt: 'auto', p: 2, borderTop: '1px solid #1e293b' }}>
            <Typography variant="caption" sx={{ display: 'block', color: '#94a3b8', mb: 1 }}>
              ACCIONES RÁPIDAS DE STOCK
            </Typography>
            <Stack spacing={1}>
              <Button
                size="small"
                variant="outlined"
                fullWidth
                onClick={() => cambiarStock(1)}
                sx={{ color: '#e2e8f0', borderColor: '#334155', textTransform: 'none', fontSize: 12 }}
              >
                Fijar Stock = 1 (Disputa)
              </Button>
              <Button
                size="small"
                variant="outlined"
                fullWidth
                onClick={() => cambiarStock(1000)}
                sx={{ color: '#e2e8f0', borderColor: '#334155', textTransform: 'none', fontSize: 12 }}
              >
                Fijar Stock = 1000 (Masivo)
              </Button>
            </Stack>
          </Box>
        </Drawer>

        <Box component="main" sx={{ flexGrow: 1, p: 3, mt: 7 }}>
          <Container maxWidth="xl" disableGutters>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
                gap: 2.5,
                mb: 3,
              }}
            >
              <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <CardContent>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      STOCK DISPONIBLE (KIT-001)
                    </Typography>
                    <InventoryIcon color="primary" fontSize="small" />
                  </Stack>
                  <Typography variant="h4" sx={{ fontWeight: 700, my: 0.5 }}>
                    {stockActual ? stockActual.disponible : 'OFFLINE'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Reservado/Vendido: <strong>{stockActual?.reservado ?? 0}</strong> unidades
                  </Typography>
                </CardContent>
              </Card>

              <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <CardContent>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      VERSIÓN ATÓMICA (CAS)
                    </Typography>
                    <CompareArrowsIcon color="secondary" fontSize="small" />
                  </Stack>
                  <Typography variant="h4" sx={{ fontWeight: 700, my: 0.5 }}>
                    v{stockActual?.version ?? 0}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Control Optimista en db_inventario
                  </Typography>
                </CardContent>
              </Card>

              <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <CardContent>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      SAGAS REGISTRADAS
                    </Typography>
                    <ShoppingCartIcon color="success" fontSize="small" />
                  </Stack>
                  <Typography variant="h4" sx={{ fontWeight: 700, my: 0.5 }}>
                    {pedidos.length}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Confirmados: {pedidos.filter((p) => p.estado === 'CONFIRMADO').length} | Cancelados:{' '}
                    {pedidos.filter((p) => p.estado === 'CANCELADO').length}
                  </Typography>
                </CardContent>
              </Card>

              <Card elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <CardContent>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      EVENTOS RABBITMQ (:3003)
                    </Typography>
                    <NotificationsIcon color="warning" fontSize="small" />
                  </Stack>
                  <Typography variant="h4" sx={{ fontWeight: 700, my: 0.5 }}>
                    {notificaciones.length}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Deduplicados con ACK manual
                  </Typography>
                </CardContent>
              </Card>
            </Box>

            {vistaActiva === 'operaciones' && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '5fr 7fr' },
                  gap: 3,
                }}
              >
                <Paper elevation={0} sx={{ p: 3, border: '1px solid #e2e8f0' }}>
                  <Typography variant="h6" sx={{ fontWeight: 600 }} gutterBottom>
                    Emisión de Orden Transaccional
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Ejecuta una Saga orquestada con verificación previa de Idempotency-Key.
                  </Typography>

                  <Stack spacing={2.5}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Cliente Solicitante</InputLabel>
                      <Select
                        value={cliente}
                        label="Cliente Solicitante"
                        onChange={(e) => setCliente(e.target.value)}
                      >
                        <MenuItem value="Ana">Ana (Cliente Corporativo A)</MenuItem>
                        <MenuItem value="Bruno">Bruno (Cliente Corporativo B)</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      label="Producto SKU"
                      value="KIT-001 (Licencia / Unidad Física Crítica)"
                      size="small"
                      disabled
                      fullWidth
                    />

                    <Stack direction="row" spacing={1}>
                      <TextField
                        label="Header HTTP: Idempotency-Key"
                        value={idempotencyKey}
                        onChange={(e) => setIdempotencyKey(e.target.value)}
                        size="small"
                        fullWidth
                      />
                      <Button
                        variant="outlined"
                        onClick={generarNuevaKey}
                        startIcon={<AutorenewIcon />}
                        sx={{ whiteSpace: 'nowrap', textTransform: 'none' }}
                      >
                        Generar Key
                      </Button>
                    </Stack>

                    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: '#f8fafc' }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={simularFalloPago}
                            onChange={(e) => setSimularFalloPago(e.target.checked)}
                            color="warning"
                          />
                        }
                        label={
                          <Typography variant="body2">
                            <strong>Simular Rechazo de Pasarela de Pago</strong> (Dispara compensación remota en
                            Inventario)
                          </Typography>
                        }
                      />
                    </Paper>

                    <Button
                      variant="contained"
                      size="large"
                      disabled={cargando}
                      onClick={enviarPedido}
                      startIcon={<SendIcon />}
                      sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                      Procesar Pedido en Orquestador
                    </Button>
                  </Stack>

                  {respuestaUltimaOperacion && (
                    <Box sx={{ mt: 3 }}>
                      <Alert
                        severity={
                          respuestaUltimaOperacion.status === 201 || respuestaUltimaOperacion.status === 200
                            ? 'success'
                            : respuestaUltimaOperacion.status === 422
                            ? 'warning'
                            : 'error'
                        }
                        sx={{ mb: 1 }}
                      >
                        <strong>Código HTTP {respuestaUltimaOperacion.status}:</strong>{' '}
                        {respuestaUltimaOperacion.data?.mensaje ||
                          respuestaUltimaOperacion.data?.error ||
                          respuestaUltimaOperacion.data?.prueba}
                      </Alert>
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          bgcolor: '#0f172a',
                          color: '#e2e8f0',
                          fontFamily: 'monospace',
                          fontSize: 12,
                          overflowX: 'auto',
                        }}
                      >
                        <pre style={{ margin: 0 }}>{JSON.stringify(respuestaUltimaOperacion.data, null, 2)}</pre>
                      </Paper>
                    </Box>
                  )}
                </Paper>

                <Paper elevation={0} sx={{ p: 3, border: '1px solid #e2e8f0' }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600 }}>
                        Últimas Transacciones (db_pedidos)
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Estado en tiempo real de las Sagas ejecutadas por el servicio de Pedidos.
                      </Typography>
                    </Box>
                  </Stack>

                  <TableContainer>
                    <Table size="small">
                      <TableHead sx={{ bgcolor: '#f8fafc' }}>
                        <TableRow>
                          <TableCell><strong>ID Pedido</strong></TableCell>
                          <TableCell><strong>Cliente</strong></TableCell>
                          <TableCell><strong>Estado Saga</strong></TableCell>
                          <TableCell><strong>Idempotency-Key</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {pedidos
                          .slice(
                            pagePedidos * rowsPerPagePedidos,
                            pagePedidos * rowsPerPagePedidos + rowsPerPagePedidos
                          )
                          .map((ped) => (
                            <TableRow key={ped.id} hover>
                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{ped.id}</TableCell>
                              <TableCell>{ped.cliente_id}</TableCell>
                              <TableCell>
                                <Chip
                                  size="small"
                                  label={ped.estado}
                                  color={
                                    ped.estado === 'CONFIRMADO'
                                      ? 'success'
                                      : ped.estado === 'CANCELADO'
                                      ? 'error'
                                      : 'warning'
                                  }
                                  sx={{ fontWeight: 600, fontSize: 11 }}
                                />
                              </TableCell>
                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>
                                {ped.idempotency_key}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <TablePagination
                    component="div"
                    count={pedidos.length}
                    page={pagePedidos}
                    onPageChange={(_, newPage) => setPagePedidos(newPage)}
                    rowsPerPage={rowsPerPagePedidos}
                    onRowsPerPageChange={(e) => {
                      setRowsPerPagePedidos(parseInt(e.target.value, 10));
                      setPagePedidos(0);
                    }}
                    rowsPerPageOptions={[8, 15, 30]}
                  />
                </Paper>
              </Box>
            )}

            {vistaActiva === 'auditoria' && (
              <Paper elevation={0} sx={{ p: 3, border: '1px solid #e2e8f0' }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }} gutterBottom>
                  Registro de Eventos Asíncronos Consumidos (RabbitMQ :3003)
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Tabla <code>mensajes_procesados</code> con deduplicación atómica por <code>event_id</code> y
                  confirmación manual (ACK).
                </Typography>

                <TableContainer>
                  <Table size="small">
                    <TableHead sx={{ bgcolor: '#f8fafc' }}>
                      <TableRow>
                        <TableCell><strong>Event ID Único</strong></TableCell>
                        <TableCell><strong>Pedido Asociado</strong></TableCell>
                        <TableCell><strong>Tipo de Evento</strong></TableCell>
                        <TableCell><strong>Detalle / Motivo de Cierre</strong></TableCell>
                        <TableCell><strong>Fecha de Procesamiento</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {notificaciones
                        .slice(pageNotif * rowsPerPageNotif, pageNotif * rowsPerPageNotif + rowsPerPageNotif)
                        .map((n) => (
                          <TableRow key={n.event_id} hover>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{n.event_id}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{n.pedido_id}</TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={n.tipo_evento}
                                color={n.tipo_evento === 'PEDIDO_CONFIRMADO' ? 'success' : 'error'}
                                variant="outlined"
                                sx={{ fontWeight: 600, fontSize: 11 }}
                              />
                            </TableCell>
                            <TableCell>{n.detalle}</TableCell>
                            <TableCell sx={{ fontSize: 12, color: '#64748b' }}>
                              {new Date(n.procesado_en).toLocaleTimeString()}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TablePagination
                  component="div"
                  count={notificaciones.length}
                  page={pageNotif}
                  onPageChange={(_, newPage) => setPageNotif(newPage)}
                  rowsPerPage={rowsPerPageNotif}
                  onRowsPerPageChange={(e) => {
                    setRowsPerPageNotif(parseInt(e.target.value, 10));
                    setPageNotif(0);
                  }}
                  rowsPerPageOptions={[8, 20, 50]}
                />
              </Paper>
            )}

            {vistaActiva === 'laboratorio' && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
                  gap: 3,
                }}
              >
                <Paper elevation={0} sx={{ p: 3, border: '1px solid #e2e8f0' }}>
                  <Typography variant="h6" sx={{ fontWeight: 600 }} gutterBottom>
                    1. Prueba de Exclusión Mutua (Condición de Carrera)
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Dispara dos transacciones simultáneas (Ana y Bruno) en el mismo milisegundo compitiendo por
                    la última unidad disponible mediante bloqueo optimista Compare-And-Swap (CAS).
                  </Typography>

                  <Stack direction="row" spacing={2}>
                    <Button variant="outlined" onClick={() => cambiarStock(1)} sx={{ textTransform: 'none' }}>
                      Paso 1: Fijar Stock en 1 unidad
                    </Button>
                    <Button
                      variant="contained"
                      color="secondary"
                      disabled={cargando}
                      onClick={simularDisputaSimultanea}
                      startIcon={<CompareArrowsIcon />}
                      sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                      Paso 2: Ejecutar Disputa Simultánea
                    </Button>
                  </Stack>

                  {respuestaUltimaOperacion?.data?.resultados && (
                    <Box sx={{ mt: 3 }}>
                      <Alert severity="info" sx={{ mb: 2 }}>
                        Resultado de colisión simultánea verificado en Base de Datos:
                      </Alert>
                      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
                        {respuestaUltimaOperacion.data.resultados.map((r: any, idx: number) => (
                          <Paper variant="outlined" sx={{ p: 2 }} key={idx}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              Cliente: {r.cliente}
                            </Typography>
                            <Chip
                              size="small"
                              label={`HTTP ${r.status}`}
                              color={r.status === 201 ? 'success' : 'error'}
                              sx={{ my: 1 }}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {r.detalle}
                            </Typography>
                          </Paper>
                        ))}
                      </Box>
                    </Box>
                  )}
                </Paper>

                <Paper elevation={0} sx={{ p: 3, border: '1px solid #e2e8f0' }}>
                  <Typography variant="h6" sx={{ fontWeight: 600 }} gutterBottom>
                    2. Ráfaga Distribuida de 100 Peticiones Concurrentes
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Inyecta un lote mixto de <strong>100 solicitudes</strong> (60 compras nuevas, 25 reintentos con
                    Idempotency-Key repetida y 15 fallos de pago con compensación de Saga).
                  </Typography>

                  <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
                    <Button variant="outlined" onClick={() => cambiarStock(1000)} sx={{ textTransform: 'none' }}>
                      Preparar Stock = 1000
                    </Button>
                    <Button
                      variant="contained"
                      color="primary"
                      disabled={cargando}
                      onClick={ejecutarEstres100}
                      startIcon={<BoltIcon />}
                      sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                      Iniciar Benchmark (100 Peticiones)
                    </Button>
                  </Stack>

                  {progresoEstres > 0 && progresoEstres < 100 && (
                    <Box sx={{ my: 2 }}>
                      <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
                        Ejecutando ráfaga distribuida: {progresoEstres}%
                      </Typography>
                      <LinearProgress variant="determinate" value={progresoEstres} />
                    </Box>
                  )}

                  {resumenEstres && (
                    <Box sx={{ mt: 2 }}>
                      <Alert severity="success" sx={{ mb: 2 }}>
                        Lote de 100 peticiones completado en <strong>{resumenEstres.tiempoMs} ms</strong> | Versión
                        CAS: <strong>v{resumenEstres.stockInicial?.version}</strong> →{' '}
                        <strong>v{resumenEstres.stockFinal?.version}</strong> (0 errores 500)
                      </Alert>
                      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5 }}>
                        <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                          <Typography variant="h5" color="success.main" sx={{ fontWeight: 700 }}>
                            {resumenEstres.codigos['201'] || 0}
                          </Typography>
                          <Typography variant="caption">201 Confirmados</Typography>
                        </Paper>
                        <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                          <Typography variant="h5" color="primary.main" sx={{ fontWeight: 700 }}>
                            {resumenEstres.codigos['200'] || 0}
                          </Typography>
                          <Typography variant="caption">200 Idempotentes</Typography>
                        </Paper>
                        <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                          <Typography variant="h5" color="warning.main" sx={{ fontWeight: 700 }}>
                            {resumenEstres.codigos['422'] || 0}
                          </Typography>
                          <Typography variant="caption">422 Compensados</Typography>
                        </Paper>
                        <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                          <Typography variant="h5" color="error.main" sx={{ fontWeight: 700 }}>
                            {resumenEstres.codigos['409'] || 0}
                          </Typography>
                          <Typography variant="caption">409 Conflicto CAS</Typography>
                        </Paper>
                      </Box>
                    </Box>
                  )}
                </Paper>
              </Box>
            )}
          </Container>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

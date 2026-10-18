class CircuitBreakerProxy {
  constructor(umbralFallos = 3, tiempoAperturaMs = 15000) {
    this.estado = 'CLOSED'; // Estados: CLOSED, OPEN, HALF_OPEN
    this.fallosConsecutivos = 0;
    this.umbralFallos = umbralFallos;
    this.tiempoAperturaMs = tiempoAperturaMs;
    this.proximoIntento = Date.now();
  }

  async ejecutarLlamada(fn) {
    // 1. Si el circuito está ABIERTO, verificamos si ya pasaron los 15s de enfriamiento
    if (this.estado === 'OPEN') {
      if (Date.now() > this.proximoIntento) {
        this.estado = 'HALF_OPEN';
        console.log('[Circuit Breaker] Pasando a estado HALF_OPEN (Probando recuperación de Inventario...)');
      } else {
        const segundosRestantes = Math.ceil((this.proximoIntento - Date.now()) / 1000);
        const error = new Error(`Circuit Breaker ABIERTO (Fail-Fast). Reintento en ${segundosRestantes}s`);
        error.code = 'CIRCUIT_OPEN';
        throw error;
      }
    }

    // 2. Intentar ejecutar la llamada HTTP
    try {
      const resultado = await fn();
      this.registrarExito();
      return resultado;
    } catch (error) {
      // Solo contamos como fallo de infraestructura si el servidor cayó, dio timeout o error 5xx
      // (Un error 409 SIN_STOCK es una respuesta de negocio válida, Inventario sí está vivo)
      const status = error.response?.status;
      if (!status || status >= 500 || error.code === 'ECONNABORTED' || error.code === 'ECONNREFUSED') {
        this.registrarFallo();
      }
      throw error;
    }
  }

  registrarExito() {
    if (this.estado !== 'CLOSED') {
      console.log('[Circuit Breaker] Inventario recuperado. Cerrando circuito (CLOSED).');
    }
    this.fallosConsecutivos = 0;
    this.estado = 'CLOSED';
  }

  registrarFallo() {
    this.fallosConsecutivos += 1;
    console.warn(`[Circuit Breaker] Fallo de red detectado (${this.fallosConsecutivos}/${this.umbralFallos})`);

    if (this.fallosConsecutivos >= this.umbralFallos) {
      this.estado = 'OPEN';
      this.proximoIntento = Date.now() + this.tiempoAperturaMs;
      console.error(`[Circuit Breaker] ¡UMBRAL SUPERADO! Circuito ABIERTO por ${this.tiempoAperturaMs / 1000}s.`);
    }
  }

  obtenerEstado() {
    return {
      estado: this.estado,
      fallosConsecutivos: this.fallosConsecutivos,
      umbralFallos: this.umbralFallos
    };
  }
}

// Exportamos una instancia única (Singleton) con umbral de 3 fallos y 15s de apertura
module.exports = new CircuitBreakerProxy(3, 15000);
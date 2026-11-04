import { LEASE, MensajeServidor as M } from '@preconteo/shared/schemas/verificacion';
import { esperaConJitter } from './backoff';
import { ActividadUsuario } from './ActividadUsuario';
import { AlmacenCasoEnCurso } from './AlmacenCasoEnCurso';

export const EstadoConexion = Object.freeze({
  CONECTANDO: 'conectando',
  CONECTADO: 'conectado',
  RECONECTANDO: 'reconectando',
  CERRADO: 'cerrado',
});

const TIEMPO_RESPUESTA_MS = 8_000;

/**
 * Cliente WebSocket de la consola de verificación (sin React: se puede probar solo).
 *
 * - Reconexión con backoff + full jitter; al reconectar pide la fotografía (`hola`).
 * - Latido cada 10 s con la actividad real y el caso en curso (acta + token).
 * - `tomar`/`soltar`/`resolver` devuelven promesas que se resuelven con la
 *   respuesta del servidor para ESA acta (correlación por acta).
 *
 * Eventos: `mensaje` (cada mensaje del servidor), `conexion` (EstadoConexion),
 * `casoEnCurso` (caso | null).
 */
export class ClienteVerificacion extends EventTarget {
  #ws = null;
  #intento = 0;
  #temporizadorReconexion = null;
  #temporizadorLatido = null;
  #cerradoAProposito = false;
  #actividad = new ActividadUsuario();
  #casoEnCurso = null;
  /** @type {Map<string, { aceptar: (m) => boolean, resolver: Function, rechazar: Function, temporizador: any }>} */
  #pendientes = new Map();

  /** @param {{ url: string }} opciones */
  constructor({ url }) {
    super();
    this.url = url;
    this.estado = EstadoConexion.CONECTANDO;
  }

  static urlPorDefecto() {
    const protocolo = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocolo}://${window.location.host}/ws/verificacion`;
  }

  get casoEnCurso() {
    return this.#casoEnCurso;
  }

  get intentosFallidos() {
    return this.#intento;
  }

  inactivoMs() {
    return this.#actividad.inactivoMs();
  }

  conectar() {
    this.#cerradoAProposito = false;
    this.#casoEnCurso = AlmacenCasoEnCurso.leer();
    this.#actividad.iniciar();
    this.#abrir();
  }

  cerrar() {
    this.#cerradoAProposito = true;
    clearTimeout(this.#temporizadorReconexion);
    clearInterval(this.#temporizadorLatido);
    this.#actividad.detener();
    this.#ws?.close(1000, 'cierre');
    this.#cambiarEstado(EstadoConexion.CERRADO);
  }

  /** @returns {Promise<{ acta, token, expiraEn, fencing }>} */
  tomar(acta) {
    return this.#solicitar({ tipo: 'tomar', acta }, acta, (m) => m.tipo === M.TOMADO_OK);
  }

  soltar() {
    const caso = this.#exigirCaso();
    return this.#solicitar(
      { tipo: 'soltar', acta: caso.acta, token: caso.token },
      caso.acta,
      (m) => m.tipo === M.CASO_LIBERADO,
    );
  }

  /** @param {{ decision: string, votos?: object, sufragantes?: number, motivo?: string }} decision */
  resolver(decision) {
    const caso = this.#exigirCaso();
    return this.#solicitar(
      { tipo: 'resolver', acta: caso.acta, token: caso.token, ...decision },
      caso.acta,
      (m) => m.tipo === M.CASO_RESUELTO,
    );
  }

  /* ------------------------------------------------------------------ */

  #abrir() {
    const ws = new WebSocket(this.url);
    this.#ws = ws;
    ws.addEventListener('open', () => {
      this.#intento = 0;
      this.#cambiarEstado(EstadoConexion.CONECTADO);
      this.#enviar({ tipo: 'hola' });
      this.#latir();
      clearInterval(this.#temporizadorLatido);
      this.#temporizadorLatido = setInterval(() => this.#latir(), LEASE.LATIDO_MS);
    });
    ws.addEventListener('message', (evento) => this.#alMensaje(evento.data));
    ws.addEventListener('close', () => this.#alCerrar());
  }

  #alCerrar() {
    clearInterval(this.#temporizadorLatido);
    if (this.#cerradoAProposito) return;
    this.#cambiarEstado(EstadoConexion.RECONECTANDO);
    const espera = esperaConJitter(this.#intento++);
    this.#temporizadorReconexion = setTimeout(() => this.#abrir(), espera);
  }

  #alMensaje(texto) {
    let mensaje;
    try {
      mensaje = JSON.parse(texto);
    } catch {
      return;
    }
    this.#actualizarCasoEnCurso(mensaje);
    this.#resolverPendiente(mensaje);
    this.dispatchEvent(new CustomEvent('mensaje', { detail: mensaje }));
  }

  /** El caso en curso se guarda/borra solo por mensajes del servidor. */
  #actualizarCasoEnCurso(m) {
    const esMio = this.#casoEnCurso?.acta === m.acta;
    if (m.tipo === M.TOMADO_OK) {
      this.#fijarCaso({ acta: m.acta, token: m.token, expiraEn: m.expiraEn, fencing: m.fencing });
    } else if (m.tipo === M.LOCK_RENOVADO && esMio) {
      this.#fijarCaso({ ...this.#casoEnCurso, expiraEn: m.expiraEn });
    } else if (esMio && (m.tipo === M.CASO_RESUELTO || m.tipo === M.CASO_LIBERADO)) {
      this.#fijarCaso(null);
    } else if (esMio && m.tipo === M.ERROR && m.codigo === 'LOCK_PERDIDO') {
      this.#fijarCaso(null);
    }
  }

  #fijarCaso(caso) {
    this.#casoEnCurso = caso;
    if (caso) AlmacenCasoEnCurso.guardar(caso);
    else AlmacenCasoEnCurso.limpiar();
    this.dispatchEvent(new CustomEvent('casoEnCurso', { detail: caso }));
  }

  #latir() {
    const caso = this.#casoEnCurso;
    this.#enviar({
      tipo: 'latido',
      actividad: this.#actividad.ultima,
      inactivoMs: this.#actividad.inactivoMs(),
      ...(caso ? { acta: caso.acta, token: caso.token } : {}),
    });
  }

  #solicitar(mensaje, acta, esRespuesta) {
    if (this.estado !== EstadoConexion.CONECTADO) {
      return Promise.reject(Object.assign(new Error('SIN_CONEXION'), { codigo: 'SIN_CONEXION' }));
    }
    this.#pendientes
      .get(acta)
      ?.rechazar(Object.assign(new Error('REEMPLAZADA'), { codigo: 'REEMPLAZADA' }));
    return new Promise((resolver, rechazar) => {
      const temporizador = setTimeout(() => {
        this.#pendientes.delete(acta);
        rechazar(Object.assign(new Error('SIN_RESPUESTA'), { codigo: 'SIN_RESPUESTA' }));
      }, TIEMPO_RESPUESTA_MS);
      this.#pendientes.set(acta, { aceptar: esRespuesta, resolver, rechazar, temporizador });
      this.#enviar(mensaje);
    });
  }

  #resolverPendiente(m) {
    const pendiente = m.acta && this.#pendientes.get(m.acta);
    if (!pendiente) return;
    if (m.tipo === M.ERROR) {
      pendiente.rechazar(Object.assign(new Error(m.codigo), { codigo: m.codigo }));
    } else if (pendiente.aceptar(m)) {
      pendiente.resolver(m);
    } else {
      return;
    }
    clearTimeout(pendiente.temporizador);
    this.#pendientes.delete(m.acta);
  }

  #exigirCaso() {
    if (!this.#casoEnCurso) throw Object.assign(new Error('SIN_CASO'), { codigo: 'SIN_CASO' });
    return this.#casoEnCurso;
  }

  #enviar(mensaje) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(mensaje));
  }

  #cambiarEstado(estado) {
    this.estado = estado;
    this.dispatchEvent(new CustomEvent('conexion', { detail: estado }));
  }
}

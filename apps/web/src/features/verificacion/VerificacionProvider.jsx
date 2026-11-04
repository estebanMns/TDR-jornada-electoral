'use client';

import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { ClienteVerificacion, EstadoConexion } from './net/ClienteVerificacion';
import { colaReducer, estadoInicial, Accion } from './estado/colaReducer';

const Contexto = createContext(null);

/** Tras estos reintentos se comprueba si la sesión expiró (el WS no da un 401 legible). */
const INTENTOS_ANTES_DE_REVISAR_SESION = 3;

/**
 * Un único WebSocket para toda la consola (cola, detalle y coordinación):
 * navegar entre páginas no reconecta ni pierde el caso en curso.
 */
export function VerificacionProvider({ children }) {
  const [estado, despachar] = useReducer(colaReducer, estadoInicial);
  const clienteRef = useRef(null);

  useEffect(() => {
    const cliente = new ClienteVerificacion({ url: ClienteVerificacion.urlPorDefecto() });
    clienteRef.current = cliente;

    const alMensaje = (e) => despachar(e.detail);
    const alCaso = (e) => despachar({ tipo: Accion.CASO_EN_CURSO, caso: e.detail });
    const alConexion = (e) => {
      despachar({ tipo: Accion.CONEXION, estado: e.detail });
      if (
        e.detail === EstadoConexion.RECONECTANDO &&
        cliente.intentosFallidos >= INTENTOS_ANTES_DE_REVISAR_SESION
      ) {
        revisarSesion();
      }
    };
    cliente.addEventListener('mensaje', alMensaje);
    cliente.addEventListener('casoEnCurso', alCaso);
    cliente.addEventListener('conexion', alConexion);
    cliente.conectar();
    despachar({ tipo: Accion.CASO_EN_CURSO, caso: cliente.casoEnCurso });

    return () => {
      cliente.removeEventListener('mensaje', alMensaje);
      cliente.removeEventListener('casoEnCurso', alCaso);
      cliente.removeEventListener('conexion', alConexion);
      cliente.cerrar();
    };
  }, []);

  const valor = useMemo(
    () => ({
      estado,
      cliente: () => clienteRef.current,
      limpiarError: () => despachar({ tipo: Accion.LIMPIAR_ERROR }),
    }),
    [estado],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useVerificacion() {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useVerificacion debe usarse dentro de <VerificacionProvider>');
  return valor;
}

async function revisarSesion() {
  try {
    const respuesta = await fetch('/api/auth/sesion', { cache: 'no-store' });
    if (respuesta.status === 401) window.location.assign('/login');
  } catch {
    /* sin red: el backoff sigue intentando */
  }
}

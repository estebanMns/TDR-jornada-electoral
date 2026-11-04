import { Rol } from '@preconteo/shared/roles';

/**
 * Una consola de auditoría conectada a ESTA instancia.
 * Solo guarda lo que vive con el socket; el estado del caso viaja en cada mensaje.
 */
export class SesionVerificacion {
  /**
   * @param {import('../../../core/transport/WsConnection.js').WsConnection} conexion
   * @param {{ sub: string, nombre: string, rol: string }} usuario
   */
  constructor(conexion, usuario) {
    this.conexion = conexion;
    this.usuario = usuario;
    this.conectadoDesde = Date.now();
  }

  get esCoordinador() {
    return this.usuario.rol === Rol.COORDINADOR;
  }

  enviar(mensaje) {
    return this.conexion.enviar(mensaje);
  }

  enviarTexto(texto) {
    return this.conexion.send(texto);
  }
}

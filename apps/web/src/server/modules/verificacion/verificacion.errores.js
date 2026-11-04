import { CodigoErrorVerificacion } from '@preconteo/shared/schemas/verificacion';

const MARCA = Symbol.for('preconteo.ErrorVerificacion');

/** Error de negocio de la verificación: viaja al cliente como `error {codigo, acta}`. */
export class ErrorVerificacion extends Error {
  /**
   * @param {string} codigo  uno de `CodigoErrorVerificacion`
   * @param {string} [acta]
   * @param {{ cause?: unknown }} [opciones]
   */
  constructor(codigo, acta, opciones) {
    super(codigo, opciones);
    this.name = 'ErrorVerificacion';
    this.codigo = codigo;
    this.acta = acta;
    this[MARCA] = true;
  }

  static es(e) {
    return Boolean(e && e[MARCA]);
  }
}

export { CodigoErrorVerificacion };

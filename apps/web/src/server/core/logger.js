import pino from 'pino';

/**
 * Logger raíz. Cada línea lleva la instancia para poder filtrar por appN.
 * @param {{ instancia: string, logNivel: string }} config
 */
export function crearLogger({ instancia, logNivel }) {
  return pino({
    level: logNivel,
    base: { instancia },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: ['password', '*.password', 'token', '*.token', 'headers.cookie'],
  });
}

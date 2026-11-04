import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import next from 'next';
import { crearAplicacion } from './app.js';

/**
 * Arranque de una instancia: un servidor HTTP propio que
 * 1) agrega `X-Instance` a TODA respuesta (RT-1),
 * 2) atiende SSE y WebSocket directamente (RealtimeRouter),
 * 3) delega el resto (páginas y API JSON) a Next,
 * 4) se apaga en orden ante SIGTERM (SSE → `reconectar`, WS → 1012).
 */
async function main() {
  const plataforma = crearAplicacion(process.env);
  const { config, logger, router, apagado } = plataforma;

  const appNext = next({
    dev: !config.esProduccion,
    dir: fileURLToPath(new URL('../..', import.meta.url)),
    hostname: config.http.host,
    port: config.http.puerto,
  });
  const manejarNext = appNext.getRequestHandler();
  await appNext.prepare();
  const upgradeNext = appNext.getUpgradeHandler();

  const servidor = createServer((req, res) => {
    res.setHeader('X-Instance', config.instancia);
    if (router.manejarHttp(req, res)) return;
    manejarNext(req, res);
  });

  servidor.on('upgrade', (req, socket, head) => {
    if (router.manejarUpgrade(req, socket, head)) return;
    upgradeNext(req, socket, head); // HMR de Next en desarrollo
  });

  // Conexiones largas: sin timeout de petición; los keep-alive los gobierna nginx.
  servidor.requestTimeout = 0;
  servidor.headersTimeout = 65_000;
  servidor.keepAliveTimeout = 65_000;

  apagado.agregar('dejar de aceptar conexiones', () => {
    servidor.close();
  });
  apagado.agregar('cerrar plataforma', () => plataforma.detener());
  apagado.agregar('cerrar Next', () => appNext.close?.());
  apagado.escucharSenales();

  plataforma.iniciar();
  servidor.listen(config.http.puerto, config.http.host, () => {
    logger.info({ puerto: config.http.puerto }, 'instancia lista');
  });
}

main().catch((err) => {
  console.error('No se pudo iniciar la instancia:', err);
  process.exit(1);
});

import { RemoteActasService } from './RemoteActasService.js';

/**
 * Actas module (owner: Jose). Ingestion itself runs in its own service
 * (apps/server, reached by nginx at /api/actas); inside the platform server
 * this module only registers `actasService`, the port the verification
 * module uses to apply auditor decisions.
 * @type {import('../../core/Plataforma.js').Modulo}
 */
export const moduloActas = {
  nombre: 'actas',

  registrar(p) {
    p.contenedor.registrar(
      'actasService',
      new RemoteActasService({
        baseUrl: p.config.actas.url,
        tokens: p.auth.tokens,
        logger: p.logger,
      }),
    );
  },
};

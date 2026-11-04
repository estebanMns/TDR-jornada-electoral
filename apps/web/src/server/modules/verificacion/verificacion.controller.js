import { ROLES_VERIFICACION } from '@preconteo/shared/roles';
import { HttpError } from '../../core/errors/HttpError.js';

/** `GET /api/verificacion/:acta/foto` → redirección a URL firmada (60 s). */
export class VerificacionController {
  /**
   * @param {{ http: import('../../core/http/ManejadorHttp.js').ManejadorHttp,
   *           auth: import('../../core/auth/AuthService.js').AuthService,
   *           repositorio: import('./verificacion.repository.js').VerificacionRepository,
   *           historial: import('./historial.repository.js').HistorialVerificacionRepository }} deps
   */
  constructor({ http, auth, repositorio, historial }) {
    this.foto = http.ruta(
      [auth.requireRol(...ROLES_VERIFICACION)],
      async (_request, { params }) => {
        const caso = await repositorio.leerCaso(params.acta);
        if (!caso) throw HttpError.noEncontrado('Caso');
        const url = await historial.urlFirmadaFoto(caso.acta, caso.version);
        if (!url) throw HttpError.noEncontrado('Foto');
        return new Response(null, {
          status: 302,
          headers: { Location: url, 'Cache-Control': 'no-store' },
        });
      },
    );
  }
}

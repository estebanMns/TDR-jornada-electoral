/**
 * `ActasPuerto` implementation (GENERAL §7.5) that forwards auditor decisions
 * to the actas service (apps/server), where they are applied with the same
 * atomic Lua script as any valid acta.
 *
 * It throws when the decision could not be delivered, so the verification
 * service compensates and re-enqueues the case (it never loses a decision).
 */

/** Platform decisions → actas service decisions. */
const DECISIONS = Object.freeze({
  APROBAR: 'APPROVE',
  APROBAR_CON_CORRECCION: 'APPROVE_WITH_CORRECTION',
  RECHAZAR: 'REJECT',
});

const DEFAULT_TIMEOUT_MS = 5_000;

export class ActasServiceUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ActasServiceUnavailableError';
  }
}

export class RemoteActasService {
  /**
   * @param {{ baseUrl: string,
   *           tokens: { firmar(usuario: { sub: string, rol: string, nombre: string }): Promise<string> },
   *           logger: import('pino').Logger,
   *           timeoutMs?: number,
   *           fetchImpl?: typeof fetch }} deps
   */
  constructor({ baseUrl, tokens, logger, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }) {
    this.endpoint = new URL('/api/actas/resolutions', baseUrl).toString();
    this.tokens = tokens;
    this.logger = logger.child({ component: 'remote-actas' });
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  /** @param {import('../verificacion/actas.puerto.js').Resolucion} resolution */
  async aplicarResolucion({
    acta,
    version,
    votos,
    sufragantes,
    decision,
    auditor,
    fencing,
    motivo,
  }) {
    const mapped = DECISIONS[decision];
    if (!mapped) throw new Error(`Unknown decision: ${decision}`);

    const isCorrection = mapped === 'APPROVE_WITH_CORRECTION';
    const body = {
      actaId: acta,
      version,
      decision: mapped,
      auditor: String(auditor),
      fencing,
      ...(isCorrection && votos ? { votes: votos } : {}),
      ...(isCorrection && sufragantes !== undefined ? { voters: sufragantes } : {}),
      ...(motivo ? { reason: String(motivo).slice(0, 500) } : {}),
    };
    // Identity of the auditor who decided, signed with the platform secret (never leaves the backend).
    const token = await this.tokens.firmar({
      sub: String(auditor),
      rol: 'AUDITOR',
      nombre: 'verificacion',
    });

    let response;
    try {
      response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ActasServiceUnavailableError('Actas service unreachable', { cause: error });
    }
    if (!response.ok) {
      throw new ActasServiceUnavailableError(`Actas service answered HTTP ${response.status}`);
    }

    const receipt = await response.json();
    if (receipt.result !== 'RESOLVED') {
      // A newer version superseded the case, or it was already decided: nothing to apply.
      this.logger.warn({ acta, version, receipt }, 'decision not applied by the actas service');
    }
    return receipt;
  }
}

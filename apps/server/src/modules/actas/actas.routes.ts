import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import {
  ACTA_ID_PATTERN,
  actaSubmissionSchema,
  idempotencyKeySchema,
  type ActaReceipt,
  type ReceiptResult,
} from '@electoral/shared';
import type { Authorize } from '../../core/auth';
import { ActasError } from './actas.errors';
import type { ActasService } from './actas.service';

export interface ActasRoutesOptions {
  service: ActasService;
  authorize: Authorize;
  jurorRateLimit: preHandlerAsyncHookHandler;
  instanceId: string;
}

/** Max photo size accepted (the juror app compresses to ~150 KB). */
export const MAX_PHOTO_BYTES = 400 * 1024;
const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Seconds the client should wait before retrying a NOT_REGISTERED submission. */
const RETRY_AFTER_SECONDS = 2;

const HTTP_STATUS_BY_RESULT: Record<ReceiptResult, number> = {
  REGISTERED: 201,
  ALREADY_REGISTERED: 200,
  OBSOLETE: 200,
  UNDER_REVIEW: 200,
  CONFLICT: 200,
  NOT_REGISTERED: 503,
};

const photoParamsSchema = z.object({
  actaId: z.string().regex(ACTA_ID_PATTERN),
  version: z.coerce.number().int().min(1),
});

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: 'INVALID_REQUEST', issues: error.issues });
}

/** HTTP adapter: validation, auth and mapping to the service. No business logic. */
export async function actasRoutes(app: FastifyInstance, options: ActasRoutesOptions): Promise<void> {
  const { service, authorize, jurorRateLimit, instanceId } = options;
  const jurorOnly = authorize('JUROR');

  app.addContentTypeParser(PHOTO_CONTENT_TYPES, { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ActasError) {
      if (error.code === 'NOT_REGISTERED') {
        request.log.warn({ err: error.cause }, 'acta not registered: storage unavailable');
        const body = request.body as { actaId?: string; version?: number } | undefined;
        const receipt: ActaReceipt = {
          actaId: body?.actaId ?? '',
          version: body?.version ?? 0,
          result: 'NOT_REGISTERED',
          reason: 'STORAGE_UNAVAILABLE',
          instance: instanceId,
        };
        return reply.code(503).header('Retry-After', String(RETRY_AFTER_SECONDS)).send(receipt);
      }
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) return reply.send(error);
    request.log.error({ err: error }, 'unexpected error in actas module');
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });

  app.post('/api/actas', { preHandler: [jurorOnly, jurorRateLimit] }, async (request, reply) => {
    const idempotencyKey = idempotencyKeySchema.safeParse(request.headers['idempotency-key']);
    if (!idempotencyKey.success) {
      return reply.code(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    }
    const submission = actaSubmissionSchema.safeParse(request.body);
    if (!submission.success) return sendValidationError(reply, submission.error);

    const receipt = await service.submit({
      submission: submission.data,
      idempotencyKey: idempotencyKey.data,
      juror: request.user,
    });
    return reply.code(HTTP_STATUS_BY_RESULT[receipt.result]).send(receipt);
  });

  app.put('/api/actas/:actaId/v/:version/photo', { preHandler: [jurorOnly, jurorRateLimit] }, async (request, reply) => {
    const params = photoParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error);
    const contentType = request.headers['content-type']?.split(';')[0]?.trim() ?? '';
    if (!PHOTO_CONTENT_TYPES.includes(contentType) || !Buffer.isBuffer(request.body)) {
      return reply.code(415).send({ error: 'UNSUPPORTED_PHOTO_TYPE' });
    }
    await service.storePhoto({
      actaId: params.data.actaId,
      version: params.data.version,
      bytes: request.body,
      contentType,
      juror: request.user,
    });
    return reply.code(204).send();
  });

  // Polled every 15 s by the juror app: ETag makes the common case a tiny 304.
  app.get('/api/actas/mine', { preHandler: [jurorOnly] }, async (request, reply) => {
    const actas = await service.listJurorActas(request.user);
    const body = JSON.stringify({ actas });
    const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, no-cache');
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type('application/json').send(body);
  });
}

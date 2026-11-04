import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { isStreamId, isTopicId, MAX_TOPICS_PER_CONNECTION, type TopicId } from '@electoral/shared';
import { redisStatus } from '../../core/redis';
import { SseConnection } from '../../core/transport/sseConnection';
import type { Redis } from 'ioredis';
import type { PublicoRepository } from './publico.repository';
import type { PublicStreamService } from './publico.service';
import type { VitalsService } from './vitals.service';

export interface PublicoRoutesOptions {
  service: PublicStreamService;
  vitals: VitalsService;
  repository: PublicoRepository;
  redis: Redis;
  instanceId: string;
  streamRateLimit: preHandlerAsyncHookHandler;
  vitalsRateLimit: preHandlerAsyncHookHandler;
}

/** `?topics=dep,mun:11` → valid, unique, at most 3. */
export function parseTopics(raw: unknown): TopicId[] | null {
  if (typeof raw !== 'string') return null;
  const topics = [...new Set(raw.split(',').map((t) => t.trim()).filter(Boolean))];
  if (topics.length === 0 || topics.length > MAX_TOPICS_PER_CONNECTION) return null;
  return topics.every(isTopicId) ? (topics as TopicId[]) : null;
}

/** `Last-Event-ID` header (native reconnection) or `?lastEventId=` (manual reconnection). */
function lastEventIdOf(request: FastifyRequest): string | null {
  const header = request.headers['last-event-id'];
  const fromQuery = (request.query as Record<string, unknown>).lastEventId;
  const candidate = typeof header === 'string' && header ? header : typeof fromQuery === 'string' ? fromQuery : '';
  return isStreamId(candidate) ? candidate : null;
}

/** Spreads the first reconnection of 400.000 browsers (1–5 s). */
const randomRetryMs = () => 1_000 + Math.floor(Math.random() * 4_000);

const vitalSchema = z.object({ name: z.literal('INP'), value: z.number().nonnegative().max(60_000) });

/** HTTP/SSE of the public audience. Validation and mapping only. */
export async function publicoRoutes(app: FastifyInstance, options: PublicoRoutesOptions): Promise<void> {
  const { service, vitals, repository, redis, instanceId } = options;

  app.get('/api/publico/stream', { preHandler: options.streamRateLimit }, async (request, reply) => {
    const topics = parseTopics((request.query as Record<string, unknown>).topics);
    if (!topics) return reply.code(400).send({ error: 'INVALID_TOPICS', max: MAX_TOPICS_PER_CONNECTION });

    reply.hijack(); // the response is now a long-lived SSE stream
    const connection = new SseConnection(reply.raw, {
      retryMs: randomRetryMs(),
      headers: { 'X-Instance': instanceId },
    });
    await service.open(connection, topics, lastEventIdOf(request));
  });

  app.get('/api/publico/snapshot', async (request, reply) => {
    const topics = parseTopics((request.query as Record<string, unknown>).topic);
    if (!topics || topics.length !== 1) return reply.code(400).send({ error: 'INVALID_TOPIC' });
    if (redisStatus(redis) !== 'ok') return reply.code(503).header('Retry-After', '1').send({ error: 'DEGRADED' });
    const [snapshot] = await repository.snapshot(topics);
    return reply.header('Cache-Control', 'no-store').send(snapshot);
  });

  // sendBeacon may send the JSON as text/plain.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.post('/api/vitals', { preHandler: options.vitalsRateLimit }, async (request, reply) => {
    const sample = vitalSchema.safeParse(request.body);
    if (!sample.success) return reply.code(400).send({ error: 'INVALID_SAMPLE' });
    await vitals.record(sample.data.value).catch(() => {}); // best effort: never fails the page
    return reply.code(204).send();
  });
}

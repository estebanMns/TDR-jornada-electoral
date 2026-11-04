/**
 * Sends a test acta over HTTP, as a juror would (DEVELOPMENT ONLY).
 *
 *   pnpm fake-acta --table 42                  # valid acta, version 1
 *   pnpm fake-acta --table 42 --kind doubtful  # tally does not balance → UNDER_REVIEW
 *   pnpm fake-acta --table 42 --kind correction  # next version of the table's acta
 *   pnpm fake-acta --table 42 --repeat 5       # same submission (same key) 5 times
 *
 * Env: API_URL (default http://localhost:3000), JWT_SECRET (to sign a dev token).
 */
import { createHmac, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  CANDIDATE_IDS,
  VOTE_OPTION_IDS,
  type ActaSubmission,
  type Catalog,
  type JurorActaState,
  type JwtPayload,
  type Votes,
} from '@electoral/shared';
import catalogJson from '../packages/shared/catalog.json' with { type: 'json' };

const catalog = catalogJson as Catalog;

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

/** HS256 token equivalent to the one issued by the login endpoint. */
function signDevToken(payload: JwtPayload, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1_000);
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + 8 * 3_600 }));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function randomVotes(voters: number): Votes {
  const votes = Object.fromEntries(VOTE_OPTION_IDS.map((option) => [option, 0])) as Votes;
  for (let i = 0; i < voters; i++) {
    const roll = Math.random();
    const option =
      roll < 0.9
        ? CANDIDATE_IDS[Math.floor(Math.random() * CANDIDATE_IDS.length)]!
        : (['BLANK', 'NULL', 'UNMARKED'] as const)[Math.floor(Math.random() * 3)]!;
    votes[option] += 1;
  }
  return votes;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      table: { type: 'string', default: '1' },
      kind: { type: 'string', default: 'valid' },
      repeat: { type: 'string', default: '1' },
    },
  });
  const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
  const secret = process.env.JWT_SECRET ?? 'change-me-dev-only';
  const tableId = Number(values.table);
  const table = catalog.tables.find((candidate) => candidate.id === tableId);
  if (!table) throw new Error(`Table ${tableId} is not in the catalog`);

  const token = signDevToken(
    { sub: `juror-${String(tableId).padStart(4, '0')}`, role: 'JUROR', name: `Jurado mesa ${tableId}`, tableId },
    secret,
  );
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  let version = 1;
  if (values.kind === 'correction') {
    const response = await fetch(`${apiUrl}/api/actas/mine`, { headers });
    const { actas } = (await response.json()) as { actas: JurorActaState[] };
    version = (actas.find((acta) => acta.actaId === table.actaId)?.maxVersion ?? 0) + 1;
  }

  const voters = Math.floor(table.enabled * (0.5 + Math.random() * 0.4));
  const submission: ActaSubmission = {
    actaId: table.actaId,
    version,
    tableId,
    votes: randomVotes(voters),
    voters: values.kind === 'doubtful' ? voters + 3 : voters,
    photoHash: createHmac('sha256', 'fake-photo').update(`${table.actaId}-${version}`).digest('hex'),
  };

  const idempotencyKey = randomUUID();
  for (let attempt = 1; attempt <= Number(values.repeat); attempt++) {
    const response = await fetch(`${apiUrl}/api/actas`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': idempotencyKey },
      body: JSON.stringify(submission),
    });
    console.info(`#${attempt} HTTP ${response.status} [${response.headers.get('x-instance')}]`, await response.json());
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

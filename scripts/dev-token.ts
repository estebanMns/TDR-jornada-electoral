/**
 * Prints a juror token and a URL that opens the juror app already signed in
 * (DEVELOPMENT ONLY, until the login screen exists).
 *
 *   pnpm dev-token --table 42
 */
import { parseArgs } from 'node:util';
import { devJurorPayload, devSecret, signDevToken } from './lib/devToken';

const { values } = parseArgs({
  options: {
    table: { type: 'string', default: '1' },
    web: { type: 'string', default: 'http://localhost:5173' },
  },
});

const token = signDevToken(devJurorPayload(Number(values.table)), devSecret());
console.info(token);
console.info(`\n${values.web}/jurado/#token=${token}`);

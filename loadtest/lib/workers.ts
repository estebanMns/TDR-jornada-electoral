import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Splits a load test across processes: one process tops out around
 * ~25.000–30.000 sockets (ephemeral ports, memory, event loop). Each child
 * runs the same script with `--worker <index>`.
 */
export function forkWorkers(scriptUrl: string, count: number, args: string[]): ChildProcess[] {
  const script = fileURLToPath(scriptUrl);
  return Array.from({ length: count }, (_, index) =>
    fork(script, [...args, '--worker', String(index)], { execArgv: ['--import', 'tsx'] }),
  );
}

export function isWorker(): boolean {
  return process.argv.includes('--worker');
}

export function workerIndex(): number {
  return Number(process.argv[process.argv.indexOf('--worker') + 1] ?? 0);
}

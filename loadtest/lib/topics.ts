import type { TopicId } from '@electoral/shared';

/** Topic mix of the public audience: 60 % department, 35 % municipality, 5 % station. */
export function topicForClient(index: number, municipalities = 30, stations = 1_842): TopicId {
  const r = Math.random();
  if (r < 0.6) return 'dep';
  if (r < 0.95) return `mun:${(index % municipalities) + 1}`;
  return `station:${(index % stations) + 1}`;
}

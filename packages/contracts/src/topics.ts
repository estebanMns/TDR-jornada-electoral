/** Public subscription topics: department, municipality and polling station. */
export type TopicId = 'dep' | `mun:${number}` | `station:${number}`;

export const topics = {
  department: (): TopicId => 'dep',
  municipality: (municipalityId: number): TopicId => `mun:${municipalityId}`,
  station: (stationId: number): TopicId => `station:${stationId}`,
} as const;

const TOPIC_PATTERN = /^(dep|mun:\d+|station:\d+)$/;

export function isTopicId(value: string): value is TopicId {
  return TOPIC_PATTERN.test(value);
}

import type { TopicId } from '@electoral/shared';
import type { ClientConnection } from '../../core/transport/clientConnection';

/**
 * A public connection of THIS instance. The only per-user state kept in
 * memory (RT-2); it dies with the socket.
 */
export interface PublicSubscriber {
  readonly connection: ClientConnection;
  readonly topics: readonly TopicId[];
  /** Last `ev:all` id this client has (everything up to it is delivered). */
  lastId: string;
  /** While catching up (replay/snapshot) live windows are not sent, only noted. */
  catchingUp: boolean;
  missedWindowWhileCatchingUp: boolean;
  /** Set when the client is too slow and stopped receiving deltas (RF-9). */
  laggingSince: number | null;
  /** Catch up again when Redis comes back (it failed while degraded). */
  needsResync: boolean;
}

export function createSubscriber(connection: ClientConnection, topics: readonly TopicId[]): PublicSubscriber {
  return {
    connection,
    topics,
    lastId: '0-0',
    catchingUp: true,
    missedWindowWhileCatchingUp: false,
    laggingSince: null,
    needsResync: false,
  };
}

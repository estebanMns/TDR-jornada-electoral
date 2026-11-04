/**
 * Transport-agnostic long-lived connection (Adapter, GENERAL §3.2; owner: Meneses).
 * The fan-out only talks to this interface, so it measures `bufferedBytes()`
 * the same way for SSE and WebSocket.
 */
export interface ClientConnection {
  readonly id: string;
  readonly kind: 'sse' | 'ws';
  readonly isOpen: boolean;
  /** Sends an already serialized frame. Returns false when the socket buffer is above its high-water mark. */
  send(frame: string): boolean;
  /** Bytes queued in user space waiting for the socket (backpressure, RF-9). */
  bufferedBytes(): number;
  /** Closes the connection telling the client why. */
  close(reason: string): void;
  /** Called once the pending buffer has been flushed to the socket. */
  onDrain(listener: () => void): () => void;
  onClose(listener: () => void): () => void;
}

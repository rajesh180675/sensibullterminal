import type { TickUpdate, WsStatus } from '../../utils/breezeWs';

interface TerminalEventMap {
  'stream:tick': TickUpdate;
  'stream:status': {
    status: WsStatus;
    transport: 'websocket' | 'polling' | 'system';
    at: number;
  };
}

type EventKey = keyof TerminalEventMap;
type Listener<T extends EventKey> = (payload: TerminalEventMap[T]) => void;

class TerminalEventBus {
  private listeners = new Map<EventKey, Set<Listener<EventKey>>>();

  emit<T extends EventKey>(event: T, payload: TerminalEventMap[T]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;

    for (const listener of listeners) {
      (listener as Listener<T>)(payload);
    }
  }

  on<T extends EventKey>(event: T, listener: Listener<T>): () => void {
    const listeners = this.listeners.get(event) ?? new Set<Listener<EventKey>>();
    listeners.add(listener as Listener<EventKey>);
    this.listeners.set(event, listeners);

    return () => {
      const current = this.listeners.get(event);
      if (!current) return;
      current.delete(listener as Listener<EventKey>);
      if (current.size === 0) {
        this.listeners.delete(event);
      }
    };
  }
}

export const terminalEventBus = new TerminalEventBus();

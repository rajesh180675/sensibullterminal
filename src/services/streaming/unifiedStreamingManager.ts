import { breezeWs, startTickPolling, type TickUpdate, type WsStatus } from '../../utils/breezeWs';
import { terminalEventBus } from './eventBus';
import type { StreamTransport } from './streamAuthority';

export class UnifiedStreamingManager {
  private stopPolling: (() => void) | null = null;

  connect(
    backendUrl: string,
    onTick: (update: TickUpdate) => void = () => undefined,
    onStatus: (status: WsStatus) => void = () => undefined,
  ): void {
    const publishStatus = (status: WsStatus, transport: StreamTransport) => {
      terminalEventBus.emit('stream:status', {
        status,
        transport,
        at: Date.now(),
      });
      onStatus(status);
    };
    const publishTick = (update: TickUpdate, transport: StreamTransport) => {
      terminalEventBus.emit('stream:tick', {
        update,
        transport,
        receivedAt: Date.now(),
      });
      onTick(update);
    };

    breezeWs.connect(backendUrl, (update) => {
      publishTick(update, 'websocket');
    }, (status) => {
      publishStatus(status, 'websocket');
      if (status === 'error') {
        if (this.stopPolling) {
          this.stopPolling();
          this.stopPolling = null;
        }
        this.stopPolling = startTickPolling(backendUrl, (update) => {
          publishStatus('connected', 'polling');
          publishTick(update, 'polling');
        });
      }
    });
  }

  disconnect(): void {
    breezeWs.disconnect();
    if (this.stopPolling) {
      this.stopPolling();
      this.stopPolling = null;
    }
    terminalEventBus.emit('stream:status', {
      status: 'disconnected',
      transport: 'system',
      at: Date.now(),
    });
  }
}

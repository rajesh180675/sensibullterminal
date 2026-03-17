import { breezeWs, startTickPolling, type TickUpdate, type WsStatus } from '../../utils/breezeWs';
import { terminalEventBus } from './eventBus';

export class UnifiedStreamingManager {
  private stopPolling: (() => void) | null = null;

  connect(
    backendUrl: string,
    onTick: (update: TickUpdate) => void = () => undefined,
    onStatus: (status: WsStatus) => void = () => undefined,
  ): void {
    this.disconnect();
    const publishStatus = (status: WsStatus, transport: 'websocket' | 'polling' | 'system') => {
      terminalEventBus.emit('stream:status', {
        status,
        transport,
        at: Date.now(),
      });
      onStatus(status);
    };
    const publishTick = (update: TickUpdate) => {
      terminalEventBus.emit('stream:tick', update);
      onTick(update);
    };

    breezeWs.connect(backendUrl, publishTick, (status) => {
      publishStatus(status, 'websocket');
      if (status === 'error') {
        this.stopPolling = startTickPolling(backendUrl, (update) => {
          publishStatus('connected', 'polling');
          publishTick(update);
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

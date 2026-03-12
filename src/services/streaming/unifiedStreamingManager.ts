import { breezeWs, startTickPolling, type TickUpdate, type WsStatus } from '../../utils/breezeWs';

export class UnifiedStreamingManager {
  private stopPolling: (() => void) | null = null;

  connect(
    backendUrl: string,
    onTick: (update: TickUpdate) => void,
    onStatus: (status: WsStatus) => void,
  ): void {
    this.disconnect();
    breezeWs.connect(backendUrl, onTick, (status) => {
      onStatus(status);
      if (status === 'error') {
        this.stopPolling = startTickPolling(backendUrl, onTick);
      }
    });
  }

  disconnect(): void {
    breezeWs.disconnect();
    if (this.stopPolling) {
      this.stopPolling();
      this.stopPolling = null;
    }
  }
}

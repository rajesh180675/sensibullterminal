import { truthDescriptor, type TruthDescriptor } from '../../lib/truth';
import type { WsStatus } from '../../utils/breezeWs';

export type StreamTransport = 'websocket' | 'polling' | 'system';
export type StreamMode = 'live' | 'degraded' | 'simulated';
export type BackpressureLevel = 'none' | 'elevated' | 'high';

const STALE_AFTER_MS = 15_000;
const EXPIRED_AFTER_MS = 45_000;
const ELEVATED_BACKPRESSURE_BATCH = 120;
const HIGH_BACKPRESSURE_BATCH = 260;
const ELEVATED_PROCESSING_MS = 24;
const HIGH_PROCESSING_MS = 60;

export interface StreamMetrics {
  transport: StreamTransport;
  wsStatus: WsStatus;
  lastStatusAt: number;
  lastTickAt: number | null;
  lastTickReceivedAt: number | null;
  lastTickVersion: number | null;
  tickBatchSize: number;
  versionGap: number;
  processingMs: number;
  staleAfterMs: number;
}

export interface StreamAuthoritySnapshot {
  mode: StreamMode;
  transport: StreamTransport;
  wsStatus: WsStatus;
  truth: TruthDescriptor;
  label: string;
  detail: string;
  ageMs: number | null;
  isStale: boolean;
  backpressureLevel: BackpressureLevel;
  tickBatchSize: number;
  versionGap: number;
  processingMs: number;
  canTrade: boolean;
  canUseLiveData: boolean;
  canRefreshBrokerData: boolean;
}

export function createInitialStreamMetrics(): StreamMetrics {
  return {
    transport: 'system',
    wsStatus: 'disconnected',
    lastStatusAt: Date.now(),
    lastTickAt: null,
    lastTickReceivedAt: null,
    lastTickVersion: null,
    tickBatchSize: 0,
    versionGap: 0,
    processingMs: 0,
    staleAfterMs: STALE_AFTER_MS,
  };
}

export function computeBackpressureLevel(metrics: Pick<StreamMetrics, 'tickBatchSize' | 'versionGap' | 'processingMs'>): BackpressureLevel {
  if (
    metrics.tickBatchSize >= HIGH_BACKPRESSURE_BATCH ||
    metrics.versionGap > 1 ||
    metrics.processingMs >= HIGH_PROCESSING_MS
  ) {
    return 'high';
  }

  if (
    metrics.tickBatchSize >= ELEVATED_BACKPRESSURE_BATCH ||
    metrics.processingMs >= ELEVATED_PROCESSING_MS
  ) {
    return 'elevated';
  }

  return 'none';
}

export function deriveStreamAuthority(params: {
  sessionConnected: boolean;
  backendBacked: boolean;
  metrics: StreamMetrics;
  now?: number;
}): StreamAuthoritySnapshot {
  const { sessionConnected, backendBacked, metrics } = params;
  const now = params.now ?? Date.now();
  const ageMs = metrics.lastTickAt ? Math.max(0, now - metrics.lastTickAt) : null;
  const isStale = ageMs !== null && ageMs > metrics.staleAfterMs;
  const backpressureLevel = computeBackpressureLevel(metrics);

  if (!sessionConnected) {
    return {
      mode: 'simulated',
      transport: 'system',
      wsStatus: 'disconnected',
      truth: truthDescriptor('analytical', 'stream_demo_mode', now),
      label: 'Simulated',
      detail: 'Broker session is disconnected. Market data is running in demo mode.',
      ageMs,
      isStale: false,
      backpressureLevel: 'none',
      tickBatchSize: metrics.tickBatchSize,
      versionGap: metrics.versionGap,
      processingMs: metrics.processingMs,
      canTrade: false,
      canUseLiveData: false,
      canRefreshBrokerData: false,
    };
  }

  if (!backendBacked) {
    return {
      mode: 'simulated',
      transport: 'system',
      wsStatus: 'disconnected',
      truth: truthDescriptor('analytical', 'stream_browser_direct', now),
      label: 'Simulated',
      detail: 'Browser-direct mode has no backend stream. Quotes, depth, and candles are simulated.',
      ageMs,
      isStale: false,
      backpressureLevel: 'none',
      tickBatchSize: metrics.tickBatchSize,
      versionGap: metrics.versionGap,
      processingMs: metrics.processingMs,
      canTrade: false,
      canUseLiveData: false,
      canRefreshBrokerData: false,
    };
  }

  if (metrics.lastTickAt === null) {
    return {
      mode: 'degraded',
      transport: metrics.transport,
      wsStatus: metrics.wsStatus,
      truth: truthDescriptor('normalized', 'stream_waiting_for_tick', metrics.lastStatusAt),
      label: 'Degraded',
      detail: 'Backend session is live, but normalized market ticks have not arrived yet.',
      ageMs: null,
      isStale: true,
      backpressureLevel,
      tickBatchSize: metrics.tickBatchSize,
      versionGap: metrics.versionGap,
      processingMs: metrics.processingMs,
      canTrade: false,
      canUseLiveData: false,
      canRefreshBrokerData: true,
    };
  }

  const websocketHealthy = metrics.transport === 'websocket' && metrics.wsStatus === 'connected' && !isStale && backpressureLevel === 'none';
  const expired = ageMs !== null && ageMs > EXPIRED_AFTER_MS;
  const liveDataUsable = !expired && !isStale;
  const canTrade = liveDataUsable && metrics.wsStatus !== 'disconnected' && metrics.wsStatus !== 'connecting';

  if (websocketHealthy) {
    return {
      mode: 'live',
      transport: metrics.transport,
      wsStatus: metrics.wsStatus,
      truth: truthDescriptor('normalized', 'stream_live_websocket', metrics.lastTickAt),
      label: 'Live',
      detail: 'WebSocket ticks are current and flowing without visible backpressure.',
      ageMs,
      isStale: false,
      backpressureLevel,
      tickBatchSize: metrics.tickBatchSize,
      versionGap: metrics.versionGap,
      processingMs: metrics.processingMs,
      canTrade,
      canUseLiveData: true,
      canRefreshBrokerData: true,
    };
  }

  let detail = 'Market data is available but not at full stream quality.';
  if (metrics.transport === 'polling') {
    detail = 'REST polling fallback is active. Quotes are usable but no longer first-hop WebSocket live.';
  } else if (isStale) {
    detail = 'Market data is stale. Refresh or wait for the stream to recover before acting.';
  } else if (backpressureLevel !== 'none') {
    detail = 'Tick batches are arriving under backpressure. Data remains usable but updates may be compressed.';
  } else if (metrics.wsStatus === 'reconnecting' || metrics.wsStatus === 'error') {
    detail = 'Stream transport is recovering after an interruption.';
  }

  return {
    mode: 'degraded',
    transport: metrics.transport,
    wsStatus: metrics.wsStatus,
    truth: truthDescriptor('normalized', 'stream_degraded', metrics.lastTickAt),
    label: 'Degraded',
    detail,
    ageMs,
    isStale,
    backpressureLevel,
    tickBatchSize: metrics.tickBatchSize,
    versionGap: metrics.versionGap,
    processingMs: metrics.processingMs,
    canTrade,
    canUseLiveData: liveDataUsable,
    canRefreshBrokerData: true,
  };
}

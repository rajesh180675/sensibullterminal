import type {
  ExecutionBasketLeg,
  ExecutionBasketStatus,
  ExecutionBlotterItem,
  ExecutionPreview,
  ExecutionRecoveryAction,
  OptionLeg,
  SymbolCode,
} from '../../types/index';

export type ExecutionPreviewPhase = 'idle' | 'loading' | 'ready' | 'fallback';

export function nextDraftBasketId(): string {
  return `basket-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function summarizeLeg(leg: OptionLeg): string {
  return `${leg.action} ${leg.type} ${leg.strike}`;
}

export function buildBasketLegStates(
  legs: OptionLeg[],
  status: ExecutionBasketLeg['status'],
  at = Date.now(),
): ExecutionBasketLeg[] {
  return legs.map((leg) => ({
    legId: leg.id,
    summary: summarizeLeg(leg),
    status,
    updatedAt: at,
  }));
}

export function deriveDraftBasketStatus(previewStatus: ExecutionPreviewPhase): ExecutionBasketStatus {
  if (previewStatus === 'ready' || previewStatus === 'fallback') return 'ready';
  return 'staged';
}

export function deriveDraftLegStatus(previewStatus: ExecutionPreviewPhase): ExecutionBasketLeg['status'] {
  if (previewStatus === 'loading') return 'previewing';
  if (previewStatus === 'ready' || previewStatus === 'fallback') return 'previewed';
  return 'staged';
}

export function createDraftBasket(params: {
  basketId: string;
  createdAt: number;
  symbol: SymbolCode;
  legs: OptionLeg[];
  preview: ExecutionPreview;
  previewStatus: ExecutionPreviewPhase;
}): ExecutionBlotterItem {
  const { basketId, createdAt, symbol, legs, preview, previewStatus } = params;
  return {
    id: basketId,
    submittedAt: createdAt,
    symbol,
    legCount: legs.length,
    summary: legs.map(summarizeLeg).join(' | '),
    premium: preview.estimatedPremium,
    status: deriveDraftBasketStatus(previewStatus),
    response: previewStatus === 'loading'
      ? 'Preview in progress.'
      : previewStatus === 'ready'
        ? 'Broker preview ready.'
        : previewStatus === 'fallback'
          ? 'Local preview ready.'
          : 'Basket staged for preview.',
    legStates: buildBasketLegStates(legs, deriveDraftLegStatus(previewStatus), createdAt),
    legsSnapshot: legs.map((leg) => ({ ...leg })),
    previewSnapshot: preview,
    recoveryAction: 'none',
  };
}

export function updateLegState(
  item: ExecutionBlotterItem,
  legId: string,
  patch: Partial<ExecutionBasketLeg>,
): ExecutionBlotterItem {
  return {
    ...item,
    legStates: (item.legStates ?? []).map((leg) => leg.legId === legId ? { ...leg, ...patch } : leg),
  };
}

export function updateBasketState(
  item: ExecutionBlotterItem,
  patch: Partial<ExecutionBlotterItem>,
): ExecutionBlotterItem {
  return {
    ...item,
    ...patch,
  };
}

export function countResolvableLegs(item: ExecutionBlotterItem): {
  liveLegs: number;
  failedLegs: number;
  pendingLegs: number;
  filledLegs: number;
} {
  const states = item.legStates ?? [];
  return {
    liveLegs: states.filter((leg) => leg.status === 'pending' || leg.status === 'filled').length,
    failedLegs: states.filter((leg) => leg.status === 'failed' || leg.status === 'rejected').length,
    pendingLegs: states.filter((leg) => leg.status === 'pending').length,
    filledLegs: states.filter((leg) => leg.status === 'filled').length,
  };
}

export function finalizeBasket(item: ExecutionBlotterItem, response: string, completedAt = Date.now()): ExecutionBlotterItem {
  const { liveLegs, failedLegs, pendingLegs, filledLegs } = countResolvableLegs(item);
  let status: ExecutionBasketStatus = 'all_failed';
  let recoveryAction: ExecutionRecoveryAction = 'none';

  if (failedLegs === 0 && (pendingLegs > 0 || filledLegs > 0)) {
    status = filledLegs === item.legCount ? 'all_filled' : 'partial_fill';
  } else if (liveLegs > 0) {
    status = 'partial_failure';
    recoveryAction = 'manual_intervention';
  } else if (item.status === 'cancelled') {
    status = 'cancelled';
  }

  return {
    ...item,
    status,
    response,
    completedAt,
    recoveryAction,
  };
}

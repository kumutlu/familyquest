/**
 * Universal Request Model
 * -----------------------
 * Every approval-based workflow (money, transfer, reward, profile update, and
 * any future request type) is normalised into a single `NormalizedRequest`
 * shape. UI components (RequestCard, RequestDetailSheet, RequestTimeline,
 * RequestOutcomeExplanation, RequestStatusBadge) only ever read this shape, so
 * adding a new request type means registering one adapter — no switch
 * statements duplicated across screens.
 */

import { isPendingApprovalStatus, isApprovedStatus, isRejectedStatus, isCancelledStatus } from './requestStatus';
import i18n from '../i18n/config';
import { formatPence, currencyCodeFromSymbol } from '../i18n/format';

export type RequestCategory =
  | 'task'
  | 'transfer'
  | 'money_request'
  | 'petbox'
  | 'profile_update'
  | 'reward'
  | 'join';

export type RequestStatusKind = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'other';

export interface RequestParticipant {
  id?: string;
  name: string;
  avatarUrl?: string;
  role?: string;
}

export type RequestTimelineKind =
  | 'created'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'comment';

export interface RequestTimelineEvent {
  id: string;
  label: string;
  /** Epoch milliseconds, or null when the event has no concrete timestamp yet. */
  timestamp: number | null;
  kind: RequestTimelineKind;
}

export interface RequestOutcome {
  ifApproved: string;
  ifRejected: string;
}

export interface ProfileChange {
  currentDisplayName?: string;
  requestedDisplayName?: string;
  currentAvatar?: string;
  requestedAvatar?: string;
  currentAvatarId?: string | null;
  requestedAvatarId?: string | null;
}

export interface NormalizedRequest {
  id: string;
  category: RequestCategory;
  /** Human label shown as the request type, e.g. "Money Request". */
  typeLabel: string;
  /** Raw status string from the underlying document. */
  status: string;
  statusKind: RequestStatusKind;
  /** Human-readable status, e.g. "Waiting for approval". */
  statusLabel: string;
  requestedBy?: RequestParticipant;
  recipient?: RequestParticipant;
  /** Epoch milliseconds. */
  createdAt: number | null;
  /** One-line summary, e.g. "Mnalium requested £5.56". */
  primarySummary: string;
  /** Secondary line, usually the free-text message. */
  secondarySummary?: string;
  amountPence?: number;
  message?: string;
  /** Whether money has already moved as a result of this request. */
  moneyMoved?: boolean;
  outcome?: RequestOutcome;
  timeline: RequestTimelineEvent[];
  /** Structured profile diff for profile_update requests. */
  profileChange?: ProfileChange;
}

export interface RequestContext {
  resolveMember?: (id?: string) => RequestParticipant | undefined;
  resolveTask?: (id?: string) => { title?: string; pointsReward?: number } | undefined;
  rewards?: Record<string, { title: string }>;
  currency?: string;
}

// ---------------------------
// Helpers
// ---------------------------

export function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof (value as { seconds?: number }).seconds === 'number') {
    const v = value as { seconds: number; nanoseconds?: number };
    return v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1_000_000);
  }
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatAmount(amountPence: number, currency = '£'): string {
  return formatPence(amountPence, currencyCodeFromSymbol(currency));
}

export function statusKindOf(status: string | undefined): RequestStatusKind {
  if (isPendingApprovalStatus(status)) return 'pending';
  if (isApprovedStatus(status)) return 'approved';
  if (isRejectedStatus(status)) return 'rejected';
  if (isCancelledStatus(status)) return 'cancelled';
  return 'other';
}

export function statusLabelOf(status: string | undefined): string {
  switch (status) {
    case 'pending':
    case 'pending_approval':
    case 'pending_acceptance':
      return i18n.t('requests:status.waiting');
    case 'approved':
      return i18n.t('requests:status.approved');
    case 'rejected':
      return i18n.t('requests:status.rejected');
    case 'cancelled':
      return i18n.t('requests:status.cancelled');
    case 'completed':
      return i18n.t('requests:status.completed');
    default:
      return status ? status.charAt(0).toUpperCase() + status.slice(1) : i18n.t('requests:status.unknown');
  }
}

function buildTimeline(raw: any): RequestTimelineEvent[] {
  const events: RequestTimelineEvent[] = [
    {
      id: 'created',
      label: i18n.t('requests:timeline.created'),
      timestamp: toMillis(raw.createdAt),
      kind: 'created',
    },
  ];

  const status = raw.status;
  if (status === 'pending' || status === 'pending_acceptance' || status === 'pending_approval') {
    events.push({
      id: 'pending',
      label: statusLabelOf(status),
      timestamp: null,
      kind: 'pending',
    });
  } else if (status === 'approved') {
    events.push({
      id: 'approved',
      label: i18n.t('requests:timeline.approved'),
      timestamp: toMillis(raw.reviewedAt ?? raw.approvedAt),
      kind: 'approved',
    });
  } else if (status === 'rejected') {
    events.push({
      id: 'rejected',
      label: i18n.t('requests:timeline.rejected'),
      timestamp: toMillis(raw.reviewedAt),
      kind: 'rejected',
    });
    if (raw.rejectionReason) {
      events.push({
        id: 'comment',
        label: i18n.t('requests:timeline.comment', { reason: raw.rejectionReason }),
        timestamp: toMillis(raw.reviewedAt),
        kind: 'comment',
      });
    }
  } else if (status === 'cancelled') {
    events.push({
      id: 'cancelled',
      label: i18n.t('requests:timeline.cancelled'),
      timestamp: toMillis(raw.cancelledAt),
      kind: 'cancelled',
    });
  }

  return events;
}

// ---------------------------
// Adapters (one per request type)
// ---------------------------

type RequestAdapter = (raw: any, ctx: RequestContext) => NormalizedRequest;

const taskAdapter: RequestAdapter = (raw, ctx) => {
  const child = ctx.resolveMember?.(raw.assigneeId);
  const task = ctx.resolveTask?.(raw.taskId);
  const childName = child?.name || raw.assigneeName || 'A child';
  const taskTitle = task?.title || raw.taskTitle || 'a task';
  const points = raw.pointsReward ?? task?.pointsReward ?? 0;
  return {
    id: raw.id,
    category: 'task',
    typeLabel: i18n.t('requests:type.taskCompletion'),
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.assigneeId, name: childName, avatarUrl: child?.avatarUrl },
    recipient: { name: i18n.t('requests:detail.recipientParent') },
    createdAt: toMillis(raw.completedAt ?? raw.createdAt),
    primarySummary: i18n.t('requests:summary.taskCompletion', { childName, taskTitle }),
    amountPence: undefined,
    message: raw.note,
    moneyMoved: raw.status === 'approved',
    outcome: {
      ifApproved: i18n.t('requests:outcome.taskApproved', { points, childName }),
      ifRejected: i18n.t('requests:outcome.taskRejected'),
    },
    timeline: buildTimeline(raw),
  };
};

const transferAdapter: RequestAdapter = (raw, ctx) => {
  const currency = ctx.currency ?? '£';
  const from = ctx.resolveMember?.(raw.fromChildId);
  const to = ctx.resolveMember?.(raw.toChildId);
  const fromName = from?.name || raw.fromChildName || 'A child';
  const toName = to?.name || raw.toChildName || 'another child';
  return {
    id: raw.id,
    category: 'transfer',
    typeLabel: i18n.t('requests:type.transferRequest'),
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.fromChildId, name: fromName, avatarUrl: from?.avatarUrl },
    recipient: { id: raw.toChildId, name: toName, avatarUrl: to?.avatarUrl },
    createdAt: toMillis(raw.createdAt),
    primarySummary: i18n.t('requests:summary.transferRequest', {
      fromName,
      toName,
      amount: formatAmount(raw.amountPence, currency),
    }),
    secondarySummary: raw.message,
    amountPence: raw.amountPence,
    message: raw.message,
    moneyMoved: raw.status === 'approved',
    outcome: {
      ifApproved: i18n.t('requests:outcome.moneyMove', {
        amount: formatAmount(raw.amountPence, currency),
        from: fromName,
        to: toName,
      }),
      ifRejected: i18n.t('requests:outcome.noMoneyMove'),
    },
    timeline: buildTimeline(raw),
  };
};

const moneyRequestAdapter: RequestAdapter = (raw, ctx) => {
  const currency = ctx.currency ?? '£';
  const requester = ctx.resolveMember?.(raw.requesterId);
  const requestedFrom = ctx.resolveMember?.(raw.requestedFromId);
  const requesterName = requester?.name || raw.requesterName || 'A child';
  const requestedFromName = requestedFrom?.name || raw.requestedFromName || 'Parent';
  const isFromParent =
    requestedFrom?.role === 'parent' ||
    requestedFrom?.role === 'owner' ||
    raw.requestedFromRole === 'parent' ||
    raw.requestedFromRole === 'owner';
  const typeLabel = isFromParent
    ? i18n.t('requests:type.moneyRequest')
    : i18n.t('requests:type.siblingMoneyRequest');
  return {
    id: raw.id,
    category: 'money_request',
    typeLabel,
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.requesterId, name: requesterName, avatarUrl: requester?.avatarUrl },
    recipient: { id: raw.requestedFromId, name: requestedFromName, avatarUrl: requestedFrom?.avatarUrl },
    createdAt: toMillis(raw.createdAt),
    primarySummary: i18n.t('requests:summary.moneyRequest', {
      requesterName,
      amount: formatAmount(raw.amountPence, currency),
    }),
    secondarySummary: raw.message,
    amountPence: raw.amountPence,
    message: raw.message,
    moneyMoved: raw.status === 'approved',
    outcome: {
      ifApproved: i18n.t('requests:outcome.moneyMove', {
        amount: formatAmount(raw.amountPence, currency),
        from: requestedFromName,
        to: requesterName,
      }),
      ifRejected: i18n.t('requests:outcome.noMoneyMove'),
    },
    timeline: buildTimeline(raw),
  };
};

const petboxAdapter: RequestAdapter = (raw, ctx) => {
  const currency = ctx.currency ?? '£';
  const child = ctx.resolveMember?.(raw.childId);
  const childName = child?.name || raw.childName || 'A child';
  const fundName = raw.fundName || 'the Pet Box';
  return {
    id: raw.id,
    category: 'petbox',
    typeLabel: i18n.t('requests:type.petBoxDonation'),
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.childId, name: childName, avatarUrl: child?.avatarUrl },
    recipient: { name: fundName },
    createdAt: toMillis(raw.createdAt),
    primarySummary: i18n.t('requests:summary.petBoxDonation', {
      childName,
      amount: formatAmount(raw.amountPence, currency),
      fundName,
    }),
    secondarySummary: raw.message,
    amountPence: raw.amountPence,
    message: raw.message,
    moneyMoved: raw.status === 'approved',
    outcome: {
      ifApproved: i18n.t('requests:outcome.moneyMove', {
        amount: formatAmount(raw.amountPence, currency),
        from: childName,
        to: fundName,
      }),
      ifRejected: i18n.t('requests:outcome.noMoneyMove'),
    },
    timeline: buildTimeline(raw),
  };
};

const profileUpdateAdapter: RequestAdapter = (raw, ctx) => {
  const child = ctx.resolveMember?.(raw.childId);
  const childName = child?.name || raw.childName || 'A child';
  return {
    id: raw.id,
    category: 'profile_update',
    typeLabel: i18n.t('requests:type.profileUpdateRequest'),
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.childId, name: childName, avatarUrl: child?.avatarUrl },
    recipient: { name: i18n.t('requests:detail.recipientParent') },
    createdAt: toMillis(raw.createdAt),
    primarySummary: i18n.t('requests:summary.profileUpdateRequest', { childName }),
    profileChange: {
      currentDisplayName: raw.currentDisplayName,
      requestedDisplayName: raw.requestedDisplayName,
      currentAvatar: raw.currentAvatar,
      requestedAvatar: raw.requestedAvatar,
      currentAvatarId: raw.currentAvatarId || null,
      requestedAvatarId: raw.requestedAvatarId || null,
    },
    moneyMoved: false,
    outcome: {
      ifApproved: i18n.t('requests:outcome.profileApproved', { childName, requestedDisplayName: raw.requestedDisplayName }),
      ifRejected: i18n.t('requests:outcome.profileRejected', { currentDisplayName: raw.currentDisplayName }),
    },
    timeline: buildTimeline(raw),
  };
};

const rewardAdapter: RequestAdapter = (raw, ctx) => {
  const child = ctx.resolveMember?.(raw.userId);
  const childName = child?.name || raw.userName || 'A child';
  const reward = ctx.rewards?.[raw.rewardId];
  const rewardTitle = reward?.title || raw.rewardTitle || 'a reward';
  return {
    id: raw.id,
    category: 'reward',
    typeLabel: i18n.t('requests:type.rewardRequest'),
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.userId, name: childName, avatarUrl: child?.avatarUrl },
    recipient: { name: i18n.t('requests:detail.recipientParent') },
    createdAt: toMillis(raw.createdAt ?? raw.redeemedAt),
    primarySummary: i18n.t('requests:summary.rewardRequest', { childName, rewardTitle }),
    amountPence: raw.costPaid != null ? raw.costPaid * 100 : undefined,
    moneyMoved: raw.status === 'approved' || raw.status === 'completed',
    outcome: {
      ifApproved: i18n.t('requests:outcome.rewardApproved', { rewardTitle }),
      ifRejected: i18n.t('requests:outcome.rewardRejected'),
    },
    timeline: buildTimeline(raw),
  };
};

const joinAdapter: RequestAdapter = (raw) => {
  const name = raw.requestedByName || raw.displayName || 'Someone';
  return {
    id: raw.id,
    category: 'join',
    typeLabel: i18n.t('requests:type.joinRequest'),
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.requestedBy, name, avatarUrl: raw.avatarUrl },
    recipient: { name: i18n.t('requests:detail.recipientOwner') },
    createdAt: toMillis(raw.createdAt),
    primarySummary: i18n.t('requests:summary.joinRequest', { name }),
    moneyMoved: false,
    outcome: {
      ifApproved: i18n.t('requests:outcome.joinApproved', { name }),
      ifRejected: i18n.t('requests:outcome.joinRejected', { name }),
    },
    timeline: buildTimeline(raw),
  };
};

const adapters: Record<RequestCategory, RequestAdapter> = {
  task: taskAdapter,
  transfer: transferAdapter,
  money_request: moneyRequestAdapter,
  petbox: petboxAdapter,
  profile_update: profileUpdateAdapter,
  reward: rewardAdapter,
  join: joinAdapter,
};

/**
 * Normalise any raw request document (which must carry a `category` field) into
 * the universal `NormalizedRequest` shape. Unknown categories fall back to the
 * task adapter so the UI never crashes on a new type.
 */
export function normalizeRequest(raw: any, ctx: RequestContext = {}): NormalizedRequest {
  const category = (raw?.category as RequestCategory) ?? 'task';
  const adapter = adapters[category] ?? taskAdapter;
  return adapter(raw, ctx);
}

export function isKnownCategory(value: unknown): value is RequestCategory {
  return typeof value === 'string' && value in adapters;
}

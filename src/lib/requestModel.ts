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
  const negative = amountPence < 0;
  const absolute = Math.abs(amountPence) / 100;
  return `${negative ? '-' : ''}${currency}${absolute.toFixed(2)}`;
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
      return 'Waiting for approval';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'cancelled':
      return 'Cancelled';
    case 'completed':
      return 'Completed';
    default:
      return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  }
}

function buildTimeline(raw: any): RequestTimelineEvent[] {
  const events: RequestTimelineEvent[] = [
    {
      id: 'created',
      label: 'Request created',
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
      label: 'Approved',
      timestamp: toMillis(raw.reviewedAt ?? raw.approvedAt),
      kind: 'approved',
    });
  } else if (status === 'rejected') {
    events.push({
      id: 'rejected',
      label: 'Rejected',
      timestamp: toMillis(raw.reviewedAt),
      kind: 'rejected',
    });
    if (raw.rejectionReason) {
      events.push({
        id: 'comment',
        label: `Comment: ${raw.rejectionReason}`,
        timestamp: toMillis(raw.reviewedAt),
        kind: 'comment',
      });
    }
  } else if (status === 'cancelled') {
    events.push({
      id: 'cancelled',
      label: 'Cancelled',
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
    typeLabel: 'Task Completion',
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.assigneeId, name: childName, avatarUrl: child?.avatarUrl },
    recipient: { name: 'Parent' },
    createdAt: toMillis(raw.completedAt ?? raw.createdAt),
    primarySummary: `${childName} completed “${taskTitle}”`,
    amountPence: undefined,
    message: raw.note,
    moneyMoved: raw.status === 'approved',
    outcome: {
      ifApproved: `${points} points will be added to ${childName}'s balance.`,
      ifRejected: 'No points will be awarded.',
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
    typeLabel: 'Transfer Request',
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.fromChildId, name: fromName, avatarUrl: from?.avatarUrl },
    recipient: { id: raw.toChildId, name: toName, avatarUrl: to?.avatarUrl },
    createdAt: toMillis(raw.createdAt),
    primarySummary: `${fromName} requested to send ${formatAmount(raw.amountPence, currency)} to ${toName}`,
    secondarySummary: raw.message,
    amountPence: raw.amountPence,
    message: raw.message,
    moneyMoved: raw.status === 'approved',
    outcome: {
      ifApproved: `${formatAmount(raw.amountPence, currency)} will move from ${fromName}'s wallet to ${toName}'s wallet.`,
      ifRejected: 'No money will move.',
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
  const typeLabel = isFromParent ? 'Money Request' : 'Sibling Money Request';
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
    primarySummary: `${requesterName} requested ${formatAmount(raw.amountPence, currency)}`,
    secondarySummary: raw.message,
    amountPence: raw.amountPence,
    message: raw.message,
    moneyMoved: raw.status === 'approved',
    outcome: {
      ifApproved: `${formatAmount(raw.amountPence, currency)} will move from ${requestedFromName}'s wallet to ${requesterName}'s wallet.`,
      ifRejected: 'No money will move.',
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
    typeLabel: 'Pet Box Donation',
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.childId, name: childName, avatarUrl: child?.avatarUrl },
    recipient: { name: fundName },
    createdAt: toMillis(raw.createdAt),
    primarySummary: `${childName} wants to donate ${formatAmount(raw.amountPence, currency)} to ${fundName}`,
    secondarySummary: raw.message,
    amountPence: raw.amountPence,
    message: raw.message,
    moneyMoved: raw.status === 'approved',
    outcome: {
      ifApproved: `${formatAmount(raw.amountPence, currency)} will move from ${childName}'s wallet to ${fundName}.`,
      ifRejected: 'No money will move.',
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
    typeLabel: 'Profile Update Request',
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.childId, name: childName, avatarUrl: child?.avatarUrl },
    recipient: { name: 'Parent' },
    createdAt: toMillis(raw.createdAt),
    primarySummary: `${childName} wants to update their profile`,
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
      ifApproved: `${childName}'s profile will be updated to “${raw.requestedDisplayName}”.`,
      ifRejected: `The profile will stay as “${raw.currentDisplayName}”.`,
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
    typeLabel: 'Reward Request',
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.userId, name: childName, avatarUrl: child?.avatarUrl },
    recipient: { name: 'Parent' },
    createdAt: toMillis(raw.createdAt ?? raw.redeemedAt),
    primarySummary: `${childName} requested the “${rewardTitle}” reward`,
    amountPence: raw.costPaid != null ? raw.costPaid * 100 : undefined,
    moneyMoved: raw.status === 'approved' || raw.status === 'completed',
    outcome: {
      ifApproved: `The “${rewardTitle}” reward will be marked ready to fulfil.`,
      ifRejected: 'No reward will be given.',
    },
    timeline: buildTimeline(raw),
  };
};

const joinAdapter: RequestAdapter = (raw) => {
  const name = raw.requestedByName || raw.displayName || 'Someone';
  return {
    id: raw.id,
    category: 'join',
    typeLabel: 'Join Request',
    status: raw.status,
    statusKind: statusKindOf(raw.status),
    statusLabel: statusLabelOf(raw.status),
    requestedBy: { id: raw.requestedBy, name, avatarUrl: raw.avatarUrl },
    recipient: { name: 'Family Owner' },
    createdAt: toMillis(raw.createdAt),
    primarySummary: `${name} wants to join the family`,
    moneyMoved: false,
    outcome: {
      ifApproved: `${name} will be added to the family.`,
      ifRejected: `${name} will not be added to the family.`,
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

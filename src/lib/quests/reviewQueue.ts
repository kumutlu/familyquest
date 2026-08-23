/**
 * Swipe Review queue selector — Queki v2 Waves 2 + 3.
 *
 * PURE + deterministic. Builds the parent's one-card-at-a-time review queue
 * from the authoritative pending request streams:
 *   - Wave 2: quest completions (`task_completions`, `pending_approval`);
 *   - Wave 3: family transfers (`transfer_requests`, `pending`) and money
 *     requests (`money_requests`, `pending` / `pending_acceptance`).
 *
 * Reward redemptions are deliberately ABSENT: `redeemReward` completes and
 * deducts points inside one transaction with no approval gate — there is no
 * reward approval for a parent to review (parents may reverse instead).
 *
 * Each kind keeps its own domain mutation function in `src/lib/api.ts`; this
 * module only shapes the shared queue.
 *
 * Ordering rule (documented contract, unit-tested):
 *   1. oldest submission first across ALL kinds (FIFO — nothing lingers);
 *   2. ties break by childId (localeCompare), then item key.
 */
import type { CompletionLike, TaskLike } from './board';

export interface ReviewMemberLike {
  id: string;
  displayName?: string;
  avatarUrl?: string;
  colour?: string;
}

export interface ReviewItem {
  /** Stable identity used for in-flight mutation dedupe (`task:<completionId>`). */
  key: string;
  completionId: string;
  taskId?: string;
  taskTitle: string;
  pointsReward: number;
  childId?: string;
  childName: string;
  avatarUrl?: string;
  colour?: string;
  completedAtMs: number;
  periodKey?: string | null;
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
}

export function selectReviewQueue(
  completions: CompletionLike[],
  tasks: TaskLike[],
  members: ReviewMemberLike[],
): ReviewItem[] {
  const items: ReviewItem[] = completions
    .filter(c => c.status === 'pending_approval' && c.id)
    .map(c => {
      const task = tasks.find(t => t.id === c.taskId);
      const member = members.find(m => m.id === c.assigneeId);
      const completionId = String(c.id);
      return {
        key: `task:${completionId}`,
        completionId,
        taskId: c.taskId,
        taskTitle: String(task?.title ?? ''),
        pointsReward: Number(task?.pointsReward ?? 0),
        childId: c.assigneeId,
        childName: String(member?.displayName ?? ''),
        avatarUrl: member?.avatarUrl,
        colour: member?.colour,
        completedAtMs: toMillis(c.completedAt),
        periodKey: c.periodKey ?? null,
      } satisfies ReviewItem;
    });

  return items.sort((a, b) => {
    if (a.completedAtMs !== b.completedAtMs) return a.completedAtMs - b.completedAtMs;
    const childDiff = String(a.childId ?? '').localeCompare(String(b.childId ?? ''));
    if (childDiff !== 0) return childDiff;
    return a.completionId.localeCompare(b.completionId);
  });
}

// ---------------------------------------------------------------------------
// Wave 3 — unified typed review queue (quest | transfer | money_request)
// ---------------------------------------------------------------------------

export type ReviewItemKind = 'quest' | 'transfer' | 'money_request';

export interface UnifiedReviewItem {
  /** Stable identity used for in-flight mutation dedupe (`<kind>:<id>`). */
  key: string;
  kind: ReviewItemKind;
  /** Underlying request/completion document id. */
  id: string;
  /** Human title of what is being reviewed (quest title / transfer summary). */
  title: string;
  /** Quest potential reward (kind === 'quest'). */
  pointsReward?: number;
  /** Money amount in integer pence (transfer + money_request kinds). */
  amountPence?: number;
  /** Child who initiated the request (actor). */
  childId?: string;
  childName: string;
  avatarUrl?: string;
  colour?: string;
  createdAtMs: number;
  /** Money request still awaiting the target sibling's acceptance. */
  awaitingAcceptance?: boolean;
  /** Transfer/money-request counterparty (recipient or funder). */
  counterpartyName?: string;
  /** Optional free-text message attached by the requesting child. */
  message?: string;
}

export interface TransferRequestLike {
  id?: string;
  fromChildId?: string;
  fromChildName?: string;
  toChildId?: string;
  toChildName?: string;
  amountPence?: number;
  message?: string;
  status?: string;
  createdAt?: unknown;
}

export interface MoneyRequestLike {
  id?: string;
  requesterId?: string;
  requesterName?: string;
  requestedFromId?: string;
  requestedFromName?: string;
  amountPence?: number;
  message?: string;
  status?: string;
  createdAt?: unknown;
}

export interface UnifiedReviewInputs {
  completions: CompletionLike[];
  tasks: TaskLike[];
  members: ReviewMemberLike[];
  transferRequests?: TransferRequestLike[];
  moneyRequests?: MoneyRequestLike[];
}

function buildUnifiedItem(
  kind: ReviewItemKind,
  base: {
    id: string;
    title: string;
    childId?: string;
    childName: string;
    avatarUrl?: string;
    colour?: string;
    createdAtMs: number;
  },
  extra: Partial<UnifiedReviewItem> = {},
): UnifiedReviewItem {
  return { key: `${kind}:${base.id}`, kind, ...base, ...extra };
}

/**
 * One deterministic queue across all reviewable request kinds.
 * Money requests in `pending_acceptance` ARE included (a parent may force-
 * approve, matching `approveMoneyRequest`) but flagged `awaitingAcceptance`.
 */
export function selectUnifiedReviewQueue(inputs: UnifiedReviewInputs): UnifiedReviewItem[] {
  const {
    completions,
    tasks,
    members,
    transferRequests = [],
    moneyRequests = [],
  } = inputs;

  const memberOf = (id?: string) => members.find(m => m.id === id);

  const questItems: UnifiedReviewItem[] = completions
    .filter(c => c.status === 'pending_approval' && c.id)
    .map(c => {
      const task = tasks.find(t => t.id === c.taskId);
      const member = memberOf(c.assigneeId);
      return buildUnifiedItem('quest', {
        id: String(c.id),
        title: String(task?.title ?? ''),
        childId: c.assigneeId,
        childName: String(member?.displayName ?? ''),
        avatarUrl: member?.avatarUrl,
        colour: member?.colour,
        createdAtMs: toMillis(c.completedAt),
      }, { pointsReward: Number(task?.pointsReward ?? 0) });
    });

  const transferItems: UnifiedReviewItem[] = transferRequests
    .filter(r => r.status === 'pending' && r.id)
    .map(r => {
      const sender = memberOf(r.fromChildId);
      const recipient = memberOf(r.toChildId);
      return buildUnifiedItem('transfer', {
        id: String(r.id),
        title: String(r.toChildName ?? recipient?.displayName ?? ''),
        childId: r.fromChildId,
        childName: String(r.fromChildName ?? sender?.displayName ?? ''),
        avatarUrl: sender?.avatarUrl,
        colour: sender?.colour,
        createdAtMs: toMillis(r.createdAt),
      }, {
        amountPence: Number(r.amountPence ?? 0),
        counterpartyName: String(r.toChildName ?? recipient?.displayName ?? ''),
        message: r.message || undefined,
      });
    });

  const moneyItems: UnifiedReviewItem[] = moneyRequests
    .filter(
      r =>
        r.id &&
        (r.status === 'pending' || r.status === 'pending_acceptance'),
    )
    .map(r => {
      const requester = memberOf(r.requesterId);
      const funder = memberOf(r.requestedFromId);
      return buildUnifiedItem('money_request', {
        id: String(r.id),
        title: String(r.requestedFromName ?? funder?.displayName ?? ''),
        childId: r.requesterId,
        childName: String(r.requesterName ?? requester?.displayName ?? ''),
        avatarUrl: requester?.avatarUrl,
        colour: requester?.colour,
        createdAtMs: toMillis(r.createdAt),
      }, {
        amountPence: Number(r.amountPence ?? 0),
        counterpartyName: String(r.requestedFromName ?? funder?.displayName ?? ''),
        message: r.message || undefined,
        awaitingAcceptance: r.status === 'pending_acceptance',
      });
    });

  return [...questItems, ...transferItems, ...moneyItems].sort((a, b) => {
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
    const childDiff = String(a.childId ?? '').localeCompare(String(b.childId ?? ''));
    if (childDiff !== 0) return childDiff;
    return a.key.localeCompare(b.key);
  });
}

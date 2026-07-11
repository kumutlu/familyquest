export type BehaviourEventType = 'positive' | 'negative' | 'financial'

export interface BehaviourEventInput {
  type: BehaviourEventType
  reason: string
  pointsDelta: number
  walletDelta: number
}

export interface BehaviourBalances {
  rewardPoints: number
  lifetimeXP: number
  walletBalance: number
}

export interface BehaviourEffect extends BehaviourBalances {
  pointsDelta: number
  walletDelta: number
}

export const DEFAULT_DEBT_LIMIT_PENCE = -5000

const VALID_EVENT_TYPES = new Set<BehaviourEventType>(['positive', 'negative', 'financial'])

export function validateBehaviourInput(input: BehaviourEventInput): BehaviourEventInput {
  if (!VALID_EVENT_TYPES.has(input.type)) {
    throw new Error('Invalid behaviour event type.')
  }

  const reason = input.reason.trim()
  if (reason.length < 3) {
    throw new Error('Reason must be at least 3 characters long.')
  }

  if (![input.pointsDelta, input.walletDelta].every(Number.isSafeInteger)) {
    throw new Error('Deltas must be finite integers.')
  }

  if (input.type === 'positive' && (input.pointsDelta <= 0 || input.walletDelta !== 0)) {
    throw new Error('Positive events require positive points and no wallet change.')
  }
  if (input.type === 'negative' && (input.pointsDelta >= 0 || input.walletDelta !== 0)) {
    throw new Error('Negative events require negative points and no wallet change.')
  }
  if (input.type === 'financial' && (input.pointsDelta !== 0 || input.walletDelta >= 0)) {
    throw new Error('Financial penalties require a negative wallet change and no points change.')
  }

  return { ...input, reason }
}

export function calculateBehaviourEffect(
  rawInput: BehaviourEventInput,
  balances: BehaviourBalances,
  debtLimitPence = DEFAULT_DEBT_LIMIT_PENCE,
): BehaviourEffect {
  const input = validateBehaviourInput(rawInput)

  if (input.type === 'positive') {
    return {
      rewardPoints: balances.rewardPoints + input.pointsDelta,
      lifetimeXP: balances.lifetimeXP + input.pointsDelta,
      walletBalance: balances.walletBalance,
      pointsDelta: input.pointsDelta,
      walletDelta: 0,
    }
  }

  if (input.type === 'negative') {
    const rewardPoints = Math.max(0, balances.rewardPoints + input.pointsDelta)
    return {
      rewardPoints,
      lifetimeXP: balances.lifetimeXP,
      walletBalance: balances.walletBalance,
      pointsDelta: rewardPoints - balances.rewardPoints,
      walletDelta: 0,
    }
  }

  const walletBalance = balances.walletBalance + input.walletDelta
  if (walletBalance < debtLimitPence) {
    throw new Error('This penalty would exceed the family debt limit.')
  }

  return {
    rewardPoints: balances.rewardPoints,
    lifetimeXP: balances.lifetimeXP,
    walletBalance,
    pointsDelta: 0,
    walletDelta: input.walletDelta,
  }
}

type RawBehaviourEvent = Record<string, unknown> & {
  childId?: unknown
  userId?: unknown
  reason?: unknown
  title?: unknown
  createdBy?: unknown
  authorId?: unknown
  createdAt?: unknown
  timestamp?: unknown
}

export function normalizeBehaviourEvent<T extends RawBehaviourEvent>(raw: T) {
  return {
    ...raw,
    childId: raw.childId ?? raw.userId,
    reason: raw.reason ?? raw.title,
    createdBy: raw.createdBy ?? raw.authorId,
    createdAt: raw.createdAt ?? raw.timestamp,
  }
}

type DatedItem = { createdAt?: unknown; timestamp?: unknown }

function toEpochMillis(value: unknown): number {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === 'object') {
    if ('toMillis' in value && typeof value.toMillis === 'function') return value.toMillis()
    if ('toDate' in value && typeof value.toDate === 'function') return value.toDate().getTime()
    if ('seconds' in value && typeof value.seconds === 'number') return value.seconds * 1000
  }
  return 0
}

export function sortNewestFirst<T extends DatedItem>(items: readonly T[]): T[] {
  return [...items].sort((left, right) =>
    toEpochMillis(right.createdAt ?? right.timestamp) - toEpochMillis(left.createdAt ?? left.timestamp),
  )
}

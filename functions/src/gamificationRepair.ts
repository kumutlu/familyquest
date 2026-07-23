import { assertCausalGroupRecordCount } from '../../src/domain/gamification/types'

export interface RebuildRecord {
  readonly id: string
  readonly effectiveAt: number
  readonly causalGroupId: string
  readonly transitionRank: number
  readonly stream: 'eligibility' | 'event'
  readonly value: unknown
}

export interface RepairGamificationPageArgs {
  readonly familyId: string
  readonly childId: string
  readonly processingAt: number
  readonly maxRecords: 250
}

export interface RepairPostCutoverPageArgs {
  readonly familyId: string
  readonly processingAt: number
  readonly maxRecords: 250
}

export interface RepairPageResult {
  readonly status: 'checkpointed' | 'published' | 'restarted' | 'active' | 'waiting'
  readonly recordsRead: number
  readonly generationId?: string
}

export interface GamificationRepairRepository {
  repairGamificationPage(args: RepairGamificationPageArgs): Promise<RepairPageResult>
  repairPostCutoverPage(args: RepairPostCutoverPageArgs): Promise<RepairPageResult>
}

export interface GamificationRepairDependencies {
  readonly repository: GamificationRepairRepository
  readonly now: () => number
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function compareRebuildRecord(left: RebuildRecord, right: RebuildRecord): number {
  return left.effectiveAt - right.effectiveAt
    || compareStrings(left.causalGroupId, right.causalGroupId)
    || left.transitionRank - right.transitionRank
    || compareStrings(left.id, right.id)
}

export function mergeRebuildStreams(
  eligibility: readonly RebuildRecord[],
  events: readonly RebuildRecord[],
): readonly RebuildRecord[] {
  const left = [...eligibility].sort(compareRebuildRecord)
  const right = [...events].sort(compareRebuildRecord)
  const result: RebuildRecord[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length || rightIndex < right.length) {
    if (rightIndex >= right.length || (leftIndex < left.length && compareRebuildRecord(left[leftIndex], right[rightIndex]) <= 0)) {
      result.push(left[leftIndex++])
    } else {
      result.push(right[rightIndex++])
    }
  }
  return result
}

export function takeCompleteCausalGroups(
  records: readonly RebuildRecord[],
  streamExhausted: boolean,
): Readonly<{ complete: readonly RebuildRecord[]; pending: readonly RebuildRecord[] }> {
  for (let start = 0; start < records.length;) {
    let end = start + 1
    while (end < records.length && records[end].causalGroupId === records[start].causalGroupId) end += 1
    assertCausalGroupRecordCount(end - start)
    start = end
  }
  if (records.length === 0 || streamExhausted) return { complete: records, pending: [] }
  const finalGroup = records.at(-1)!.causalGroupId
  const split = records.findIndex(record => record.causalGroupId === finalGroup)
  return { complete: records.slice(0, split), pending: records.slice(split) }
}

function now(dependencies: GamificationRepairDependencies): number {
  const value = dependencies.now()
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('now must return non-negative epoch milliseconds')
  return value
}

export function repairGamificationPage(
  dependencies: GamificationRepairDependencies,
  args: Omit<RepairGamificationPageArgs, 'processingAt' | 'maxRecords'>,
): Promise<RepairPageResult> {
  return dependencies.repository.repairGamificationPage({ ...args, processingAt: now(dependencies), maxRecords: 250 })
}

export function repairPostCutoverPage(
  dependencies: GamificationRepairDependencies,
  args: Omit<RepairPostCutoverPageArgs, 'processingAt' | 'maxRecords'>,
): Promise<RepairPageResult> {
  return dependencies.repository.repairPostCutoverPage({ ...args, processingAt: now(dependencies), maxRecords: 250 })
}

export interface FinalizeFamilyDayArgs {
  readonly familyId: string
  readonly dayKey?: string
  readonly processingAt: number
}

export interface FinalizeFamilyDayResult {
  readonly snapshotsCreated: number
  readonly daysFinalized: number
}

export interface GamificationSchedulerRepository {
  finalizeFamilyDay(args: FinalizeFamilyDayArgs): Promise<FinalizeFamilyDayResult>
  listFamiliesForFinalization(processingAt: number): Promise<readonly string[]>
}

export interface GamificationSchedulerDependencies {
  readonly repository: GamificationSchedulerRepository
  readonly now: () => number
}

function currentTime(dependencies: GamificationSchedulerDependencies): number {
  const value = dependencies.now()
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('now must return non-negative epoch milliseconds')
  return value
}

export function finalizeFamilyDay(
  dependencies: GamificationSchedulerDependencies,
  args: Omit<FinalizeFamilyDayArgs, 'processingAt'>,
): Promise<FinalizeFamilyDayResult> {
  return dependencies.repository.finalizeFamilyDay({ ...args, processingAt: currentTime(dependencies) })
}

export async function finalizeGamificationDaysOnce(
  dependencies: GamificationSchedulerDependencies,
): Promise<readonly FinalizeFamilyDayResult[]> {
  const processingAt = currentTime(dependencies)
  const familyIds = [...await dependencies.repository.listFamiliesForFinalization(processingAt)].sort()
  const results: FinalizeFamilyDayResult[] = []
  for (const familyId of familyIds) results.push(await dependencies.repository.finalizeFamilyDay({ familyId, processingAt }))
  return results
}

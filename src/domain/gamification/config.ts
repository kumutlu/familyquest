export const GAMIFICATION_CONFIG_V1 = Object.freeze({
  schemaVersion: 1,
  xpPerLevel: 1000,
  defaultDailyGoalPercentage: 80,
  dailyGoalBonusXp: 25,
  perfectDayBonusXp: 50,
} as const)

export interface GamificationConfigInputV1 {
  readonly schemaVersion: 1
  readonly dailyGoalPercentage: number
}

export interface ResolvedGamificationConfigV1 {
  readonly schemaVersion: 1
  readonly xpPerLevel: number
  readonly dailyGoalPercentage: number
  readonly dailyGoalBonusXp: number
  readonly perfectDayBonusXp: number
}

export function isValidXpReward(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

export function resolveGamificationConfig(
  input: GamificationConfigInputV1 | undefined,
): Readonly<ResolvedGamificationConfigV1> {
  const dailyGoalPercentage = input?.dailyGoalPercentage ?? GAMIFICATION_CONFIG_V1.defaultDailyGoalPercentage

  if (input !== undefined && input.schemaVersion !== 1) {
    throw new Error(`Unsupported gamification config schema version: ${input.schemaVersion}`)
  }
  if (!Number.isInteger(dailyGoalPercentage) || dailyGoalPercentage < 50 || dailyGoalPercentage > 100) {
    throw new Error('dailyGoalPercentage must be an integer from 50 through 100')
  }

  return Object.freeze({
    schemaVersion: GAMIFICATION_CONFIG_V1.schemaVersion,
    xpPerLevel: GAMIFICATION_CONFIG_V1.xpPerLevel,
    dailyGoalPercentage,
    dailyGoalBonusXp: GAMIFICATION_CONFIG_V1.dailyGoalBonusXp,
    perfectDayBonusXp: GAMIFICATION_CONFIG_V1.perfectDayBonusXp,
  })
}

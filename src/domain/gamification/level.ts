export interface LevelProgress {
  readonly level: number
  readonly xpIntoLevel: number
  readonly xpToNextLevel: number
  readonly percentage: number
}

function assertXp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
}

function assertXpPerLevel(xpPerLevel: number): void {
  if (!Number.isSafeInteger(xpPerLevel) || xpPerLevel <= 0) {
    throw new Error('xpPerLevel must be a positive safe integer')
  }
}

export function levelForXp(xp: number, xpPerLevel: number): number {
  assertXp(xp, 'XP')
  assertXpPerLevel(xpPerLevel)
  return Math.floor(xp / xpPerLevel) + 1
}

export function levelProgressForXp(xp: number, xpPerLevel: number): Readonly<LevelProgress> {
  const level = levelForXp(xp, xpPerLevel)
  const xpIntoLevel = xp % xpPerLevel
  return {
    level,
    xpIntoLevel,
    xpToNextLevel: xpPerLevel - xpIntoLevel,
    percentage: Number((BigInt(xpIntoLevel) * 100n) / BigInt(xpPerLevel)),
  }
}

/**
 * Gamification V4 — Phase 1 (blocker B1): production-capable GATE 1 evidence.
 *
 * The pilot preflight found the Gate 1 evidence unusable:
 *   - no provisionable `STAGE7_GATE1_ARTIFACT`;
 *   - `03-production-replay-report.json` carries no per-family classification;
 *   - `generatedAt` is the epoch placeholder;
 *   - owner approval metadata did not exist (and must never be fabricated).
 *
 * This module builds a Gate 1 artifact that the deployed runtime
 * (`functions/src/gamification/v4/stage7EvidenceProvider.ts`) can consume.
 *
 * Hard properties:
 *  - DERIVED, NEVER INVENTED. Every family classification is computed from the
 *    reconciliation counts already present in the approved replay report.
 *  - FAIL CLOSED. malformed / ambiguous / unaccounted sources / family-level
 *    replay errors / duplicate families all throw `Gate1EvidenceError`.
 *  - REAL `generatedAt`, taken from the injected clock at generation time.
 *  - DETERMINISTIC. Canonical (sorted, fixed key order) JSON => stable sha256.
 *  - OWNER APPROVAL IS SEPARATELY SUPPLIED. There is no default, no inferred
 *    approver and no inferred approval instant.
 *  - READ ONLY. No Firestore import, no writes. File emission happens only in
 *    the CLI wrapper and only when an explicit `--out` is passed.
 */

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown whenever Gate 1 evidence cannot be derived safely. Always fail closed. */
export class Gate1EvidenceError extends Error {
  constructor(message: string) {
    super(`[gate1] ${message}`)
    this.name = 'Gate1EvidenceError'
  }
}

// ---------------------------------------------------------------------------
// Source shapes (subset of scripts/replay/production-report.ts)
// ---------------------------------------------------------------------------

export interface Gate1Counts {
  readonly exact: number
  readonly estimated: number
  readonly malformed: number
  readonly ambiguous: number
  readonly skipped: number
}

export interface Gate1SourceFamily {
  readonly familyId: string
  readonly totalSources: number
  readonly eventsBuilt: number
  readonly counts: Gate1Counts
  readonly members: Readonly<Record<string, unknown>>
  readonly displayedProvided: boolean
  readonly error?: string
}

export interface Gate1SourceReport {
  readonly gate: 'GATE_1_REACHED' | string
  readonly schemaVersion: number
  readonly totalFamilies: number
  readonly totalSources: number
  readonly totalEventsBuilt: number
  readonly counts: Gate1Counts
  readonly families: ReadonlyArray<Gate1SourceFamily>
  readonly walletSnapshot: unknown
}

// ---------------------------------------------------------------------------
// Artifact shapes
// ---------------------------------------------------------------------------

export const GATE1_ARTIFACT_VERSION = 1

/**
 * Derived, closed set of family classifications.
 *  - `exact`       — every source replayed exactly.
 *  - `estimated`   — some sources used the documented current-task-points
 *                    fallback; still fully accounted, no guessing.
 *  - `no_activity` — the family has zero replayable gamification sources.
 * Anything else is NOT a classification: it fails closed.
 */
export type Gate1Classification = 'exact' | 'estimated' | 'no_activity'

export interface Gate1FamilyAccounting {
  readonly totalSources: number
  readonly classified: number
  readonly exact: number
  readonly estimated: number
  readonly malformed: number
  readonly ambiguous: number
  readonly skipped: number
}

export interface Gate1FamilyEvidence {
  readonly familyId: string
  readonly classification: Gate1Classification
  readonly memberCount: number
  readonly eventsBuilt: number
  readonly accounting: Gate1FamilyAccounting
}

export interface Gate1ArtifactReport {
  readonly gate: 'GATE_1_REACHED'
  readonly schemaVersion: number
  readonly sourceReportHash: string
  readonly totalFamilies: number
  readonly totalSources: number
  readonly totalEventsBuilt: number
  readonly families: ReadonlyArray<Gate1FamilyEvidence>
}

export interface Gate1Accounting {
  readonly totalFamilies: number
  readonly classified: number
  readonly exact: number
  readonly estimated: number
  readonly noActivity: number
}

/** Owner approval — ALWAYS supplied out of band, NEVER derived or defaulted. */
export interface OwnerApproval {
  readonly approvedBy: string
  /** ISO-8601 instant of the real owner approval. */
  readonly approvedAt: string
  /** Optional human reference (ticket / message id) for the approval record. */
  readonly approvalRef?: string
}

export interface Gate1Artifact {
  readonly artifactVersion: number
  /** Real generation instant (never the epoch placeholder). */
  readonly generatedAt: string
  readonly report: Gate1ArtifactReport
  /** sha256 over the canonical JSON of `report`. */
  readonly reportHash: string
  /** Derived aggregate accounting (not hashed; `report` is the source of truth). */
  readonly accounting: Gate1Accounting
  readonly approvedBy: string
  readonly approvedAt: string
  readonly approvalRef: string | null
}

// ---------------------------------------------------------------------------
// Hashing (canonical + deterministic)
// ---------------------------------------------------------------------------

/** Stable stringify: object keys sorted, arrays order-preserving. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`
}

/** sha256 of the canonical JSON of the Gate 1 report. */
export function hashGate1Report(report: Gate1ArtifactReport): string {
  return createHash('sha256').update(canonicalJson(report), 'utf8').digest('hex')
}

/**
 * sha256 of the canonical JSON of the upstream source replay report.
 * Families are sorted first so the hash is insensitive to export ordering.
 */
export function hashSourceReport(report: Gate1SourceReport): string {
  const canonical = {
    ...report,
    families: [...(report.families ?? [])].sort((a, b) =>
      a.familyId < b.familyId ? -1 : a.familyId > b.familyId ? 1 : 0,
    ),
  }
  return createHash('sha256').update(canonicalJson(canonical), 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// Classification (derived from reconciliation evidence only)
// ---------------------------------------------------------------------------

function requireFiniteCount(familyId: string, name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Gate1EvidenceError(`family ${familyId}: malformed count \`${name}\` (${String(value)})`)
  }
  return value
}

/**
 * Classify ONE family purely from its reconciliation counts.
 * Fails closed on any malformed/ambiguous/unaccounted/errored input.
 */
export function classifyFamily(family: Gate1SourceFamily): Gate1FamilyEvidence {
  if (!family || typeof family.familyId !== 'string' || family.familyId.length === 0) {
    throw new Gate1EvidenceError('a family entry has no familyId')
  }
  const id = family.familyId

  if (family.error) {
    throw new Gate1EvidenceError(`family ${id}: replay recorded an error (${family.error})`)
  }
  if (!family.counts || typeof family.counts !== 'object') {
    throw new Gate1EvidenceError(`family ${id}: no classification counts present`)
  }

  const exact = requireFiniteCount(id, 'exact', family.counts.exact)
  const estimated = requireFiniteCount(id, 'estimated', family.counts.estimated)
  const malformed = requireFiniteCount(id, 'malformed', family.counts.malformed)
  const ambiguous = requireFiniteCount(id, 'ambiguous', family.counts.ambiguous)
  const skipped = requireFiniteCount(id, 'skipped', family.counts.skipped)
  const totalSources = requireFiniteCount(id, 'totalSources', family.totalSources)
  const eventsBuilt = requireFiniteCount(id, 'eventsBuilt', family.eventsBuilt)

  if (malformed > 0) {
    throw new Gate1EvidenceError(`family ${id}: ${malformed} malformed source(s) — fail closed`)
  }
  if (ambiguous > 0) {
    throw new Gate1EvidenceError(`family ${id}: ${ambiguous} ambiguous source(s) — fail closed`)
  }
  if (skipped > 0) {
    throw new Gate1EvidenceError(`family ${id}: ${skipped} skipped source(s) — unexplained, fail closed`)
  }

  const classified = exact + estimated
  if (classified !== totalSources) {
    throw new Gate1EvidenceError(
      `family ${id}: ${totalSources - classified} unaccounted source(s) ` +
        `(classified=${classified}, totalSources=${totalSources})`,
    )
  }

  const classification: Gate1Classification =
    totalSources === 0 ? 'no_activity' : estimated > 0 ? 'estimated' : 'exact'

  return {
    familyId: id,
    classification,
    memberCount: Object.keys(family.members ?? {}).length,
    eventsBuilt,
    accounting: { totalSources, classified, exact, estimated, malformed, ambiguous, skipped },
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface BuildGate1ArtifactInput {
  readonly source: Gate1SourceReport
  /** Owner approval. REQUIRED — never fabricated, never defaulted. */
  readonly approval: OwnerApproval
  /** Injected clock. Defaults to the real wall clock at generation time. */
  readonly now?: () => number
}

function assertOwnerApproval(approval: OwnerApproval | undefined): OwnerApproval {
  if (!approval) {
    throw new Gate1EvidenceError('owner approval was not supplied; refusing to fabricate one')
  }
  if (typeof approval.approvedBy !== 'string' || approval.approvedBy.trim() === '') {
    throw new Gate1EvidenceError('owner approval `approvedBy` is required and must be non-empty')
  }
  const at = Date.parse(approval.approvedAt)
  if (!Number.isFinite(at)) {
    throw new Gate1EvidenceError('owner approval `approvedAt` must be a valid ISO-8601 instant')
  }
  return approval
}

/**
 * Build the Gate 1 evidence artifact from an approved replay report.
 * READ ONLY and deterministic for a fixed `now`.
 */
export function buildGate1Artifact(input: BuildGate1ArtifactInput): Gate1Artifact {
  const approval = assertOwnerApproval(input.approval)
  const source = input.source
  const now = input.now ?? (() => Date.now())

  if (!source || typeof source !== 'object') {
    throw new Gate1EvidenceError('no source replay report supplied')
  }
  if (source.gate !== 'GATE_1_REACHED') {
    throw new Gate1EvidenceError(`source report gate=${String(source.gate)}; expected GATE_1_REACHED`)
  }
  if (!Array.isArray(source.families) || source.families.length === 0) {
    throw new Gate1EvidenceError('source report has no families')
  }

  const seen = new Set<string>()
  for (const f of source.families) {
    if (seen.has(f.familyId)) {
      throw new Gate1EvidenceError(`duplicate family entry ${f.familyId} in source report`)
    }
    seen.add(f.familyId)
  }

  const families = source.families
    .map(classifyFamily)
    .sort((a, b) => (a.familyId < b.familyId ? -1 : a.familyId > b.familyId ? 1 : 0))

  const totalSources = families.reduce((sum, f) => sum + f.accounting.totalSources, 0)
  const totalEventsBuilt = families.reduce((sum, f) => sum + f.eventsBuilt, 0)

  if (Number.isFinite(source.totalSources) && source.totalSources !== totalSources) {
    throw new Gate1EvidenceError(
      `report-level totalSources=${source.totalSources} != sum of family totals=${totalSources}`,
    )
  }
  if (Number.isFinite(source.totalFamilies) && source.totalFamilies !== families.length) {
    throw new Gate1EvidenceError(
      `report-level totalFamilies=${source.totalFamilies} != families present=${families.length}`,
    )
  }

  const report: Gate1ArtifactReport = {
    gate: 'GATE_1_REACHED',
    schemaVersion: source.schemaVersion,
    sourceReportHash: hashSourceReport(source),
    totalFamilies: families.length,
    totalSources,
    totalEventsBuilt,
    families,
  }

  const generatedAtMs = now()
  if (!Number.isFinite(generatedAtMs) || generatedAtMs <= 0) {
    throw new Gate1EvidenceError('generation clock produced an invalid instant')
  }

  return {
    artifactVersion: GATE1_ARTIFACT_VERSION,
    generatedAt: new Date(generatedAtMs).toISOString(),
    report,
    reportHash: hashGate1Report(report),
    accounting: {
      totalFamilies: families.length,
      classified: families.reduce((s, f) => s + f.accounting.classified, 0),
      exact: families.filter((f) => f.classification === 'exact').length,
      estimated: families.filter((f) => f.classification === 'estimated').length,
      noActivity: families.filter((f) => f.classification === 'no_activity').length,
    },
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    approvalRef: approval.approvalRef ?? null,
  }
}

/** Aggregate accounting view (derived, cheap, not part of the hashed report). */
export function gate1Accounting(artifact: Gate1Artifact): Gate1Accounting {
  const fams = artifact.report.families
  return {
    totalFamilies: fams.length,
    classified: fams.reduce((s, f) => s + f.accounting.classified, 0),
    exact: fams.filter((f) => f.classification === 'exact').length,
    estimated: fams.filter((f) => f.classification === 'estimated').length,
    noActivity: fams.filter((f) => f.classification === 'no_activity').length,
  }
}

// ---------------------------------------------------------------------------
// Validate (consumer contract — fail closed)
// ---------------------------------------------------------------------------

export interface ValidateGate1Options {
  readonly familyId: string
  readonly now?: () => number
  readonly maxAgeMs: number
  /** Test-only escape hatch for deliberately tampered fixtures. */
  readonly skipHashCheck?: boolean
}

export interface Gate1ValidationResult {
  readonly valid: boolean
  readonly reason?: string
  readonly classification?: Gate1Classification
}

const invalid = (reason: string): Gate1ValidationResult => ({ valid: false, reason })

/** Validate an artifact for ONE family. Never throws — returns a verdict. */
export function validateGate1Artifact(
  artifact: Gate1Artifact | null | undefined,
  options: ValidateGate1Options,
): Gate1ValidationResult {
  if (!artifact) return invalid('no Gate 1 artifact provisioned')
  if (artifact.artifactVersion !== GATE1_ARTIFACT_VERSION) {
    return invalid(`unsupported Gate 1 artifact version ${String(artifact.artifactVersion)}`)
  }
  if (artifact.report?.gate !== 'GATE_1_REACHED') {
    return invalid(`artifact gate=${String(artifact.report?.gate)}; expected GATE_1_REACHED`)
  }

  // owner approval must be explicit
  if (typeof artifact.approvedBy !== 'string' || artifact.approvedBy.trim() === '') {
    return invalid('missing owner approval (approvedBy)')
  }
  const approvedAt = Date.parse(artifact.approvedAt)
  if (!Number.isFinite(approvedAt)) return invalid('missing owner approval (approvedAt)')

  // hash integrity
  if (!options.skipHashCheck) {
    const computed = hashGate1Report(artifact.report)
    if (computed !== artifact.reportHash) {
      return invalid(`Gate 1 report hash mismatch (recorded=${artifact.reportHash} computed=${computed})`)
    }
  }

  // freshness
  const generatedAt = Date.parse(artifact.generatedAt)
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) {
    return invalid('artifact generatedAt is missing or invalid')
  }
  const now = (options.now ?? (() => Date.now()))()
  const age = now - Math.max(generatedAt, approvedAt)
  if (age < 0) return invalid('artifact is stale or invalid: generated/approved in the future')
  if (age > options.maxAgeMs) {
    return invalid(`Gate 1 artifact is stale (age=${age}ms, max=${options.maxAgeMs}ms)`)
  }

  // family binding + classification completeness
  const entry = (artifact.report.families ?? []).find((f) => f.familyId === options.familyId)
  if (!entry) return invalid(`family ${options.familyId} is not present in the Gate 1 artifact`)
  if (!entry.classification) {
    return invalid(`family ${options.familyId} is present but NOT classified`)
  }
  if (!['exact', 'estimated', 'no_activity'].includes(entry.classification)) {
    return invalid(`family ${options.familyId} has an unknown classification ${entry.classification}`)
  }
  const acc = entry.accounting
  if (!acc || acc.classified !== acc.totalSources) {
    return invalid(`family ${options.familyId} accounting is incomplete`)
  }
  if (acc.malformed > 0 || acc.ambiguous > 0 || acc.skipped > 0) {
    return invalid(`family ${options.familyId} has malformed/ambiguous/skipped sources`)
  }

  return { valid: true, classification: entry.classification }
}

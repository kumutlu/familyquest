/**
 * Gamification V4 — Phase 1 CLI: build the GATE 1 evidence artifact.
 *
 * READ-ONLY by default: reads the approved Stage 3 replay report from disk and
 * prints the derived artifact to stdout. Nothing is written unless `--out` is
 * passed explicitly. NO Firestore access of any kind, no production mutation.
 *
 * Owner approval is NEVER fabricated: `--approved-by` and `--approved-at` are
 * mandatory and are supplied by the operator out of band.
 *
 * Usage:
 *   npx tsx scripts/gate1/build-gate1-artifact.ts \
 *     --approved-by "owner@example.com" \
 *     --approved-at "2026-08-08T10:00:00.000Z" \
 *     [--approval-ref GATE1-123] \
 *     [--report docs/gamification-v4/03-production-replay-report.json] \
 *     [--out docs/gamification-v4/09-gate1-artifact.json]
 *
 * The emitted JSON is exactly what an operator provisions to the runtime as
 * `STAGE7_GATE1_ARTIFACT` (no secrets, evidence only).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildGate1Artifact,
  Gate1EvidenceError,
  type Gate1Artifact,
  type Gate1SourceReport,
} from './gate1-artifact'

export const DEFAULT_SOURCE_REPORT = 'docs/gamification-v4/03-production-replay-report.json'

export interface Gate1CliArgs {
  readonly approvedBy: string
  readonly approvedAt: string
  readonly approvalRef?: string
  readonly reportPath: string
  readonly outPath?: string
}

export function parseGate1Args(argv: readonly string[]): Gate1CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const approvedBy = get('--approved-by')
  const approvedAt = get('--approved-at')
  if (!approvedBy) throw new Gate1EvidenceError('--approved-by is required (owner approval is never fabricated)')
  if (!approvedAt) throw new Gate1EvidenceError('--approved-at is required (owner approval is never fabricated)')
  return {
    approvedBy,
    approvedAt,
    ...(get('--approval-ref') ? { approvalRef: get('--approval-ref')! } : {}),
    reportPath: get('--report') ?? DEFAULT_SOURCE_REPORT,
    ...(get('--out') ? { outPath: get('--out')! } : {}),
  }
}

/** Pure: load + derive. Performs NO writes. */
export function generateGate1Artifact(args: Gate1CliArgs, now: () => number = Date.now): Gate1Artifact {
  const raw = readFileSync(resolve(process.cwd(), args.reportPath), 'utf8')
  const source = JSON.parse(raw) as Gate1SourceReport
  return buildGate1Artifact({
    source,
    approval: {
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
      ...(args.approvalRef ? { approvalRef: args.approvalRef } : {}),
    },
    now,
  })
}

function main(argv: readonly string[]): void {
  const args = parseGate1Args(argv)
  const artifact = generateGate1Artifact(args)
  const json = JSON.stringify(artifact, null, 2)
  if (args.outPath) {
    writeFileSync(resolve(process.cwd(), args.outPath), `${json}\n`, 'utf8')
    console.log(`[gate1] wrote ${args.outPath} (reportHash=${artifact.reportHash})`)
  } else {
    console.log(json)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

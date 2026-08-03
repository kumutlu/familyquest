#!/usr/bin/env node
/**
 * Gamification V3 — Phase 0 inventory generator.
 *
 * Scans every tracked file under src/, functions/src/, scripts/, tests/ plus
 * firestore.rules and firestore.indexes.json for every gamification read,
 * write and calculation, and regenerates the machine-generated region of
 *
 *   docs/gamification-v3/05-current-state-inventory.md
 *
 * This script is READ-ONLY with respect to runtime code and production data.
 * It never touches Firestore. It is safe to run at any time.
 *
 *   node scripts/gamification-inventory.cjs           # rewrite the document
 *   node scripts/gamification-inventory.cjs --check   # fail if out of date
 *   node scripts/gamification-inventory.cjs --json    # emit raw records
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const DOC = path.join(ROOT, 'docs/gamification-v3/05-current-state-inventory.md')
const BEGIN = '<!-- BEGIN GENERATED: gamification-inventory -->'
const END = '<!-- END GENERATED: gamification-inventory -->'

/** Every term the Phase 0 brief requires us to account for. */
const TERMS = [
  'rewardPoints',
  'lifetimeXP',
  'xpTotal',
  'weeklyXP',
  'weeklyPoints',
  'currentStreak',
  'longestStreak',
  'bestStreak',
  'xpProgressInLevel',
  'xpToNextLevel',
  'gamification_summaries',
  'gamification_events',
  'task_occurrences',
  'behaviour_events',
  'levelFromXp',
  'levelProgressForXp',
  'redeemReward',
  'unlockAvatar',
  'claimChallenge',
  'createChallenge',
  'reversal',
  'leaderboard',
]

/**
 * `level` on its own is far too common (log level, zoom level, CSS level) to
 * grep blindly, so it is matched only in gamification-shaped positions.
 */
const NARROW = [
  { term: 'level', re: /\b(?:summary|progression|state|member|child|user|g)\.level\b|\blevel\s*:\s*(?:levelFromXp|levelForXp|Math\.|[0-9])|\bnewLevel\b|\blevelProgress\b/ },
]

const TERM_RE = new RegExp(`\\b(${TERMS.join('|')})\\b`, 'i')

function listFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  return out
    .split('\n')
    .filter(Boolean)
    .filter(
      (f) =>
        /^src\//.test(f) ||
        /^functions\/src\//.test(f) ||
        /^scripts\//.test(f) ||
        /^tests\//.test(f) ||
        f === 'firestore.rules' ||
        f === 'firestore.indexes.json',
    )
    .filter((f) => !/\.(png|jpg|jpeg|svg|ico|webp|woff2?|ttf)$/i.test(f))
    // The generator itself necessarily contains every search term.
    .filter((f) => f !== 'scripts/gamification-inventory.cjs')
    .sort()
}

const isTest = (f) => /\.test\.[tj]sx?$/.test(f) || /^tests\//.test(f) || /\.spec\.[tj]sx?$/.test(f)
const isScriptMigration = (f) =>
  /^scripts\/(migrate|backfill|legacy-xp|repair|reconcile|investigate|audit|dump|recovery|scan|verify)/.test(f)

function operationOf(file, line) {
  if (isTest(file)) return 'test'
  if (isScriptMigration(file)) return 'migrate'
  if (/^src\/i18n\/locales\//.test(file)) return 'read'
  if (/\b(rewardPoints|lifetimeXP|currentStreak|longestStreak|bestStreak|weeklyPoints|xpTotal)\s*:\s*0\b/.test(line)) {
    return 'initialise'
  }
  if (
    /(transaction|batch)\.(update|set)|\bsetDoc\(|\bupdateDoc\(|\.update\(|\.set\(|FieldValue\.increment/.test(line) ||
    /\b(rewardPoints|lifetimeXP|xpTotal|weeklyPoints|currentStreak|longestStreak|bestStreak)\s*:\s*[^,)]*[+\-]/.test(line)
  ) {
    return 'write'
  }
  if (/[+\-*/%]=|\breduce\(|\bsort\(|\bMath\.|[)\w]\s*[+\-*/%]\s*[(\w]/.test(line)) return 'calculate'
  return 'read'
}

function sourceOf(line, term) {
  if (/gamification_summaries/.test(line)) return 'families/{f}/gamification_summaries'
  if (/gamification_events/.test(line)) return 'families/{f}/gamification_events'
  if (/task_occurrences/.test(line)) return 'families/{f}/task_occurrences'
  if (/behaviour_events/.test(line)) return 'families/{f}/behaviour_events'
  if (/task_completions/.test(line)) return 'families/{f}/task_completions'
  if (/\breversals?\b/i.test(line)) return 'families/{f}/reversals'
  switch (term) {
    case 'rewardPoints':
    case 'lifetimeXP':
    case 'currentStreak':
    case 'longestStreak':
      return `users.${term}`
    case 'xpTotal':
    case 'bestStreak':
    case 'xpProgressInLevel':
    case 'xpToNextLevel':
      return `summary.${term}`
    case 'weeklyXP':
    case 'weeklyPoints':
      return 'derived (client-computed today)'
    default:
      return 'in-memory / derived'
  }
}

const SEMANTICS = {
  rewardPoints: 'Spendable Reward Points balance (RP)',
  lifetimeXP: 'Legacy duplicate lifetime XP counter',
  xpTotal: 'Projection lifetime XP counter (authoritative today)',
  weeklyXP: 'Client-computed weekly leaderboard score',
  weeklyPoints: 'Weekly leaderboard score',
  currentStreak: 'Consecutive qualifying days',
  longestStreak: 'Legacy best-streak counter on the user doc',
  bestStreak: 'Projection best-streak counter',
  xpProgressInLevel: 'XP accumulated inside the current level',
  xpToNextLevel: 'XP remaining until the next level',
  gamification_summaries: 'Legacy projection collection',
  gamification_events: 'Existing XP event ledger',
  task_occurrences: 'Server-side task occurrence dedupe records',
  behaviour_events: 'Behaviour intent log',
  levelFromXp: 'Duplicate level formula',
  levelProgressForXp: 'Canonical level formula',
  redeemReward: 'Reward redemption (RP debit)',
  unlockAvatar: 'Avatar unlock (RP debit)',
  claimChallenge: 'Family challenge claim (RP + XP credit)',
  createChallenge: 'Family challenge configuration',
  reversal: 'Reversal / compensation path',
  leaderboard: 'Leaderboard ordering',
  level: 'Member level',
}

/**
 * Disposition rules. First match wins. Documented in
 * docs/gamification-v3/02-data-model.md §2 and §2.1.
 */
const RULES = [
  { re: /^src\/domain\/gamification\//, decision: 'KEEP', phase: 'Phase 1', risk: 'Low', why: 'Canonical pure domain — becomes the V3 reducer core' },
  { re: /^functions\/src\/gamification/, decision: 'KEEP', phase: 'Phase 1-2', risk: 'Medium', why: 'Server writer — extended into the V3 command pipeline' },
  { re: /^functions\/src\/behaviour/, decision: 'KEEP', phase: 'Phase 2', risk: 'Medium', why: 'Server behaviour writer — emits BEHAVIOUR ledger events' },
  { re: /^functions\/src\/(familyDeletion|childDeletion|leaveFamily|childJoinRequest|index)/, decision: 'KEEP', phase: 'Phase 6', risk: 'Low', why: 'Lifecycle/cleanup — collection list updated when legacy is dropped' },
  { re: /^src\/lib\/gamificationAdapters\.ts$/, decision: 'REMOVE', phase: 'Phase 4', risk: 'High', why: 'Legacy fallback + duplicate formulas — absorbed by the projection reducer' },
  { re: /^src\/lib\/gamificationStreaks\./, decision: 'REMOVE', phase: 'Phase 4', risk: 'Medium', why: 'Streak resolution moves into the reducer' },
  { re: /^src\/lib\/gamificationProgression\./, decision: 'REMOVE', phase: 'Phase 4', risk: 'Medium', why: 'Progression resolution moves into the reducer' },
  { re: /^src\/lib\/achievements\./, decision: 'DERIVE', phase: 'Phase 4', risk: 'Medium', why: 'Badge unlocking becomes reducer-derived; UI keeps labels only' },
  { re: /^src\/lib\/behaviour\./, decision: 'REMOVE', phase: 'Phase 3', risk: 'High', why: 'Client-side balance maths duplicated server-side' },
  { re: /^src\/lib\/reversalApi\./, decision: 'MIGRATE', phase: 'Phase 3', risk: 'High', why: 'Direct balance write becomes a REVERSAL ledger event' },
  { re: /^src\/lib\/(reversalHistory|api)\./, decision: 'MIGRATE', phase: 'Phase 3', risk: 'High', why: 'Client gamification writes become callable commands' },
  { re: /^src\/lib\/googleRedirectAuth\./, decision: 'MIGRATE', phase: 'Phase 3', risk: 'Medium', why: 'Member bootstrap stops seeding gamification fields' },
  { re: /^src\/lib\/bootstrapQueries\./, decision: 'REMOVE', phase: 'Phase 4', risk: 'Medium', why: 'Direct summaries query replaced by the single reader' },
  { re: /^src\/lib\/notifications/, decision: 'KEEP', phase: 'Phase 4', risk: 'Low', why: 'Notification copy only' },
  { re: /^src\/config\//, decision: 'KEEP', phase: 'n/a', risk: 'Low', why: 'Configuration and documentation, not a balance' },
  { re: /^src\/i18n\//, decision: 'KEEP', phase: 'n/a', risk: 'Low', why: 'Translation keys and labels' },
  { re: /^src\/(pages|components)\//, decision: 'DERIVE', phase: 'Phase 4', risk: 'High', why: 'UI must read the single reader and perform no arithmetic' },
  { re: /^src\/store\//, decision: 'DERIVE', phase: 'Phase 4', risk: 'Medium', why: 'Store stops carrying gamification balances' },
  { re: /^scripts\/(migrate|backfill|legacy-xp|repair|reconcile)/, decision: 'MIGRATE', phase: 'Phase 5', risk: 'Medium', why: 'Historical one-shot migration tooling' },
  { re: /^scripts\/(investigate|audit|dump|recovery|scan|verify|query|read|find)/, decision: 'TEMPORARY COMPATIBILITY', phase: 'Phase 6', risk: 'Low', why: 'Read-only operational forensics against legacy shapes' },
  { re: /^scripts\/(seed|smoke|cleanup|reset|export)/, decision: 'MIGRATE', phase: 'Phase 5', risk: 'Low', why: 'Fixture/seed data follows the new schema' },
  { re: /^scripts\//, decision: 'TEMPORARY COMPATIBILITY', phase: 'Phase 6', risk: 'Low', why: 'Ad-hoc tooling against legacy shapes' },
  { re: /^firestore\.rules$/, decision: 'MIGRATE', phase: 'Phase 1-5', risk: 'High', why: 'Rules tighten to deny all client gamification writes' },
  { re: /^firestore\.indexes\.json$/, decision: 'MIGRATE', phase: 'Phase 1', risk: 'Low', why: 'Indexes follow the new collections' },
  { re: /^tests\/firestore\//, decision: 'MIGRATE', phase: 'Phase 1-5', risk: 'Medium', why: 'Rules tests rewritten alongside the rules' },
  { re: /^tests\/|\.test\.[tj]sx?$/, decision: 'MIGRATE', phase: 'Phase 1-4', risk: 'Low', why: 'Test rewritten against the V3 contract' },
]

function dispositionOf(file) {
  for (const rule of RULES) if (rule.re.test(file)) return rule
  return { decision: 'KEEP', phase: 'n/a', risk: 'Low', why: 'Unclassified — review before Phase 1' }
}

function scan() {
  const records = []
  for (const file of listFiles()) {
    let text
    try {
      text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    } catch {
      continue
    }
    if (text.includes('\u0000')) continue
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const found = new Set()
      const m = line.match(new RegExp(`\\b(${TERMS.join('|')})\\b`, 'g'))
      if (m) m.forEach((t) => found.add(t))
      for (const n of NARROW) if (n.re.test(line)) found.add(n.term)
      if (found.size === 0) continue
      const d = dispositionOf(file)
      for (const term of found) {
        records.push({
          file,
          line: i + 1,
          term,
          operation: operationOf(file, line),
          source: sourceOf(line, term),
          semantic: SEMANTICS[term] || term,
          decision: d.decision,
          phase: d.phase,
          risk: d.risk,
          why: d.why,
          text: line.trim().slice(0, 160),
        })
      }
    }
  }
  return records
}

function esc(s) {
  return String(s).replace(/\|/g, '\\|').replace(/`/g, '\u02cb')
}

function countBy(records, key) {
  const out = new Map()
  for (const r of records) out.set(r[key], (out.get(r[key]) || 0) + 1)
  return [...out.entries()].sort((a, b) => b[1] - a[1])
}

function render(records) {
  const lines = []
  const p = (s = '') => lines.push(s)

  const byFile = new Map()
  for (const r of records) {
    if (!byFile.has(r.file)) byFile.set(r.file, [])
    byFile.get(r.file).push(r)
  }

  p(`_Generated by [\`scripts/gamification-inventory.cjs\`](scripts/gamification-inventory.cjs:1). Do not edit by hand._`)
  p()
  p(`Occurrences: **${records.length}** across **${byFile.size}** files.`)
  p()

  p('### Totals by operation')
  p()
  p('| Operation | Count |')
  p('|---|---|')
  for (const [k, v] of countBy(records, 'operation')) p(`| ${k} | ${v} |`)
  p()

  p('### Totals by V3 decision')
  p()
  p('| Decision | Count |')
  p('|---|---|')
  for (const [k, v] of countBy(records, 'decision')) p(`| ${k} | ${v} |`)
  p()

  p('### Totals by risk')
  p()
  p('| Risk | Count |')
  p('|---|---|')
  for (const [k, v] of countBy(records, 'risk')) p(`| ${k} | ${v} |`)
  p()

  p('### Totals by term')
  p()
  p('| Term | Count |')
  p('|---|---|')
  for (const [k, v] of countBy(records, 'term')) p(`| \`${k}\` | ${v} |`)
  p()

  p('### Full occurrence table')
  p()
  for (const [file, rs] of [...byFile.entries()].sort()) {
    const d = rs[0]
    p(`#### \`${file}\` — ${d.decision} · ${d.phase} · risk ${d.risk}`)
    p()
    p(`> ${d.why}`)
    p()
    p('| Line | Term | Operation | Source | Semantic meaning | Code |')
    p('|---|---|---|---|---|---|')
    for (const r of rs.sort((a, b) => a.line - b.line || a.term.localeCompare(b.term))) {
      p(
        `| ${r.line} | \`${r.term}\` | ${r.operation} | ${esc(r.source)} | ${esc(r.semantic)} | \`${esc(r.text)}\` |`,
      )
    }
    p()
  }

  return lines.join('\n')
}

function main() {
  const records = scan()
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(records, null, 2))
    return
  }
  const generated = render(records)
  const existing = fs.readFileSync(DOC, 'utf8')
  const a = existing.indexOf(BEGIN)
  const b = existing.indexOf(END)
  if (a === -1 || b === -1) {
    throw new Error(`Missing generated markers in ${DOC}`)
  }
  const next = `${existing.slice(0, a + BEGIN.length)}\n\n${generated}\n\n${existing.slice(b)}`
  if (process.argv.includes('--check')) {
    if (next !== existing) {
      process.stderr.write('gamification inventory is out of date; run: node scripts/gamification-inventory.cjs\n')
      process.exit(1)
    }
    process.stdout.write(`inventory up to date (${records.length} occurrences)\n`)
    return
  }
  fs.writeFileSync(DOC, next)
  process.stdout.write(`wrote ${records.length} occurrences to ${path.relative(ROOT, DOC)}\n`)
}

module.exports = { scan, TERMS, RULES }

if (require.main === module) main()

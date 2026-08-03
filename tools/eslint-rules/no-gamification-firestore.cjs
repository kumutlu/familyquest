/**
 * Repository-local architecture rule: `no-gamification-firestore`.
 *
 * Purpose (Gamification V3, Phase 0): prevent NEW architectural violations
 * while the V3 refactor is implemented. It does not change runtime behaviour
 * and it never auto-fixes.
 *
 * The rule fails when frontend code:
 *   1. directly imports Firestore in a file that touches gamification paths;
 *   2. directly reads `gamification_summaries` / `gamification_state` /
 *      `gamification_events` outside the approved data-access layer;
 *   3. directly reads `users.rewardPoints` / `users.lifetimeXP` (and the other
 *      authoritative balance fields) off a member/user object;
 *   4. directly writes rewardPoints, lifetimeXP, XP, level or streak fields;
 *   5. performs gamification arithmetic in React pages/components;
 *   6. calculates weekly leaderboard values from task completions;
 *   7. calculates levels with local formulas.
 *
 * Approved locations are controlled by a SHRINK-ONLY allowlist in
 * `gamification-allowlist.json`. See docs/gamification-v3/05-current-state-inventory.md.
 *
 * The module is dependency-free and exposes both:
 *   - `rule`    — an ESLint-compatible rule object (meta/create);
 *   - `analyze` — a pure (filename, source) -> violations[] function used by
 *                 the CI runner and by the structural tests.
 */

'use strict'

const VIOLATIONS = {
  FIRESTORE_IMPORT: 'firestore-import',
  SUMMARY_READ: 'summary-read',
  USER_BALANCE_READ: 'user-balance-read',
  BALANCE_WRITE: 'balance-write',
  GAMIFICATION_ARITHMETIC: 'gamification-arithmetic',
  WEEKLY_FROM_COMPLETIONS: 'weekly-from-completions',
  LOCAL_LEVEL_FORMULA: 'local-level-formula',
}

const MESSAGES = {
  [VIOLATIONS.FIRESTORE_IMPORT]:
    'Frontend code must not import Firestore for gamification paths. Use src/services/gamification/.',
  [VIOLATIONS.SUMMARY_READ]:
    'Direct gamification collection access is only allowed in src/services/gamification/.',
  [VIOLATIONS.USER_BALANCE_READ]:
    'Do not read authoritative gamification fields off the user/member record. Use the single reader.',
  [VIOLATIONS.BALANCE_WRITE]:
    'Clients must not write gamification fields. Emit a command; the server owns the ledger.',
  [VIOLATIONS.GAMIFICATION_ARITHMETIC]:
    'No arithmetic on gamification values in pages/components. The projection reducer computes them.',
  [VIOLATIONS.WEEKLY_FROM_COMPLETIONS]:
    'Weekly leaderboard values must come from gamification_state.weeklyPoints, not from task completions.',
  [VIOLATIONS.LOCAL_LEVEL_FORMULA]:
    'Levels and level progress come from the projection. Do not reimplement the formula locally.',
}

/** The only place allowed to touch Firestore for gamification. */
const APPROVED_SERVICE = /^src\/services\/gamification\//

/** Pure domain: canonical formulas live here and touch no Firestore. */
const PURE_DOMAIN = /^src\/domain\//

/** Enforcement scope: the frontend application only. */
function isFrontendFile(filename) {
  const f = normalise(filename)
  if (!/^src\//.test(f)) return false
  if (!/\.[jt]sx?$/.test(f)) return false
  if (/\.(test|spec)\.[jt]sx?$/.test(f)) return false
  if (/^src\/test\//.test(f) || /^src\/__tests__\//.test(f)) return false
  if (APPROVED_SERVICE.test(f)) return false
  if (PURE_DOMAIN.test(f)) return false
  return true
}

function normalise(filename) {
  return String(filename).replace(/\\/g, '/').replace(/^\.\//, '')
}

const BALANCE_FIELDS = [
  'rewardPoints',
  'lifetimeXP',
  'xpTotal',
  'weeklyPoints',
  'weeklyXP',
  'currentStreak',
  'longestStreak',
  'bestStreak',
  'perfectDayCount',
]

const GAMIFICATION_COLLECTIONS = ['gamification_summaries', 'gamification_state', 'gamification_events']

const RE = {
  firestoreImport: /from\s+['"]firebase\/firestore['"]|require\(\s*['"]firebase\/firestore['"]\s*\)/,
  collections: new RegExp(`\\b(${GAMIFICATION_COLLECTIONS.join('|')})\\b`),
  // `x.rewardPoints`, `x?.lifetimeXP`, destructuring off a member/user object.
  balanceRead: new RegExp(`[\\w\\]\\)]\\s*\\??\\.\\s*(${BALANCE_FIELDS.join('|')})\\b`),
  // `{ rewardPoints: <expr> }` inside a write call, or an explicit Firestore write.
  writeCall: /(?:transaction|batch|t)\s*\.\s*(?:update|set)\s*\(|\b(?:setDoc|updateDoc|addDoc|runTransaction|writeBatch)\s*\(|\.\s*(?:update|set)\s*\(\s*[\w.]+\s*,/,
  writeField: new RegExp(`\\b(${BALANCE_FIELDS.join('|')}|level)\\s*:`),
  levelFormula:
    /%\s*XP_PER_LEVEL|XP_PER_LEVEL\s*-|Math\.floor\s*\(\s*[\w.]*[xX][pP][\w.]*\s*\/|levelFromXp\s*\(|xpProgressInLevel\s*\(|\/\s*1000\s*\)\s*\*\s*100|xpProgressInLevel\s*\/\s*\d/,
  arithmetic: new RegExp(
    `(?:${BALANCE_FIELDS.join('|')}|xpProgressInLevel|xpToNextLevel)[^\\n]*?(?:\\+=|-=|\\+\\s*\\(|\\breduce\\s*\\(|\\bsort\\s*\\()|` +
      `(?:\\+=|-=)\\s*\\(?[\\w.?]*(?:${BALANCE_FIELDS.join('|')})|` +
      `\\breduce\\s*\\([^\\n]*(?:${BALANCE_FIELDS.join('|')})`,
  ),
  completionSource: /completions?\b|task_completions|pointsReward/,
  weeklyAccumulator: /\bweekly(?:XP|Points)\b/i,
}

const REACT_UI = /^src\/(pages|components)\//

/**
 * @param {string} filename repo-relative path
 * @param {string} source   file contents
 * @returns {Array<{kind:string,line:number,column:number,message:string,text:string}>}
 */
function analyze(filename, source) {
  const file = normalise(filename)
  if (!isFrontendFile(file)) return []

  const violations = []
  const lines = String(source).split('\n')
  const wholeFile = String(source)
  const stripped = lines.map(stripCommentsAndStrings)

  const mentionsGamification =
    RE.collections.test(wholeFile) || BALANCE_FIELDS.some((f) => new RegExp(`\\b${f}\\b`).test(wholeFile))

  // Values supplied by the approved read model may be formatted freely.
  const readModelBindings = collectReadModelBindings(wholeFile)

  const push = (kind, index) =>
    violations.push({
      kind,
      line: index + 1,
      column: 1,
      message: MESSAGES[kind],
      text: lines[index].trim().slice(0, 160),
      file,
    })

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const code = stripped[i]
    if (!code.trim()) continue

    if (mentionsGamification && RE.firestoreImport.test(raw)) push(VIOLATIONS.FIRESTORE_IMPORT, i)

    // Collection names survive string stripping deliberately: paths are strings.
    if (RE.collections.test(raw) && !isCommentOnly(raw)) push(VIOLATIONS.SUMMARY_READ, i)

    const isWriteLine = RE.writeCall.test(code) && RE.writeField.test(code)
    if (isWriteLine) push(VIOLATIONS.BALANCE_WRITE, i)

    const readable = maskReadModelAccess(code, readModelBindings)
    if (!isWriteLine && RE.balanceRead.test(readable)) push(VIOLATIONS.USER_BALANCE_READ, i)

    if (RE.levelFormula.test(code)) push(VIOLATIONS.LOCAL_LEVEL_FORMULA, i)

    if (REACT_UI.test(file) && RE.arithmetic.test(code)) push(VIOLATIONS.GAMIFICATION_ARITHMETIC, i)
  }

  // Weekly aggregation is a multi-line shape: a weekly accumulator in the same
  // file as task-completion scanning.
  if (RE.weeklyAccumulator.test(wholeFile) && RE.completionSource.test(wholeFile)) {
    const index = lines.findIndex((l) => RE.weeklyAccumulator.test(l))
    push(VIOLATIONS.WEEKLY_FROM_COMPLETIONS, index === -1 ? 0 : index)
  }

  return dedupe(violations)
}

/** Identifiers bound to the approved read model, e.g. `const g = useGamification(id)`. */
function collectReadModelBindings(source) {
  const bindings = new Set()
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*use(?:Family)?Gamification\s*\(/g
  let m
  while ((m = re.exec(source)) !== null) bindings.add(m[1])
  return bindings
}

function maskReadModelAccess(code, bindings) {
  if (bindings.size === 0) return code
  let out = code
  for (const id of bindings) {
    out = out.replace(new RegExp(`\\b${id}\\s*\\??\\.\\s*`, 'g'), `${id}__READMODEL__`)
  }
  return out
}

function dedupe(violations) {
  const seen = new Set()
  const out = []
  for (const v of violations) {
    const key = `${v.kind}:${v.line}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind))
}

function isCommentOnly(line) {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

/** Remove line comments and string literals so prose cannot trip the rule. */
function stripCommentsAndStrings(line) {
  let out = line.replace(/\/\/.*$/, '')
  out = out.replace(/\/\*.*?\*\//g, '')
  if (isCommentOnly(line)) return ''
  out = out.replace(/'(?:[^'\\]|\\.)*'/g, "''")
  out = out.replace(/"(?:[^"\\]|\\.)*"/g, '""')
  return out
}

/* ------------------------------------------------------------------ *
 * ESLint-compatible rule object.
 * ------------------------------------------------------------------ */

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid direct Firestore gamification access, gamification writes and gamification arithmetic in frontend code.',
      recommended: true,
      url: 'docs/gamification-v3/01-architecture.md',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowlist: { type: 'array', items: { type: 'object' } },
        },
        additionalProperties: false,
      },
    ],
    messages: Object.fromEntries(Object.entries(MESSAGES).map(([k, v]) => [toMessageId(k), v])),
    fixable: null,
  },

  create(context) {
    const filename = normalise(
      typeof context.filename === 'string' ? context.filename : context.getFilename(),
    )
    const options = (context.options && context.options[0]) || {}
    const allowlist = options.allowlist || []

    return {
      Program(node) {
        const sourceCode = context.sourceCode || (context.getSourceCode && context.getSourceCode())
        const text = sourceCode ? sourceCode.getText() : ''
        for (const v of analyze(filename, text)) {
          if (isAllowed(allowlist, filename, v.kind)) continue
          context.report({
            node,
            loc: { line: v.line, column: 0 },
            messageId: toMessageId(v.kind),
          })
        }
      },
    }
  },
}

function toMessageId(kind) {
  return kind.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function isAllowed(allowlist, filename, kind) {
  const file = normalise(filename)
  const entry = (allowlist || []).find((e) => normalise(e.path) === file || file.endsWith(`/${normalise(e.path)}`))
  return Boolean(entry && entry.violations.includes(kind))
}

module.exports = {
  rule,
  analyze,
  isAllowed,
  isFrontendFile,
  normalise,
  VIOLATIONS,
  MESSAGES,
  BALANCE_FIELDS,
  GAMIFICATION_COLLECTIONS,
}

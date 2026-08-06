#!/usr/bin/env node
/**
 * Static expression-budget analyser for firestore.rules.
 *
 * READ-ONLY. Never writes to firestore.rules.
 *
 * Firestore inlines every function invocation at evaluation time; there is no
 * memoisation across distinct call sites. So the cost of an `allow` statement
 * is the cost of its fully-expanded expression tree.
 *
 * We compute two metrics per validator:
 *   reads  - reachable get()/getAfter()/exists() calls (expensive, and each
 *            drags in the whole document-shape evaluation)
 *   exprs  - a proxy expression count: operators + comparisons + reads,
 *            expanded transitively through the call graph.
 */
const fs = require('fs');

const src = fs.readFileSync('firestore.rules', 'utf8');
const lines = src.split('\n');

// ---- 1. Extract function bodies (brace-balanced) -------------------------
const fns = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\s*function\s+(\w+)\s*\(([^)]*)\)\s*\{/);
  if (!m) continue;
  let depth = 0, body = '', started = false;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    body += lines[j] + '\n';
    if (started && depth === 0) break;
  }
  fns.set(m[1], { name: m[1], line: i + 1, body });
}

// ---- 2. Local (non-transitive) cost of a snippet -------------------------
const READ_RE = /\b(?:get|getAfter|exists|existsAfter)\s*\(\s*\/databases/g;
function localReads(body) { return (body.match(READ_RE) || []).length; }
function localExprs(body) {
  const ops = (body.match(/&&|\|\||==|!=|>=|<=|[<>]|\bin\b|\bis\b|\?/g) || []).length;
  return ops + localReads(body) * 3; // a read + its path construction
}

// ---- 3. Direct callees ---------------------------------------------------
function callees(body) {
  const out = [];
  const re = /\b(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(body))) {
    if (fns.has(m[1])) out.push(m[1]);
  }
  return out;
}

// ---- 4. Transitive expansion (multiplicity preserved, cycle-guarded) -----
const memo = new Map();
function cost(name, stack = []) {
  if (stack.includes(name)) return { reads: 0, exprs: 0 };      // cycle
  if (memo.has(name)) return memo.get(name);
  const fn = fns.get(name);
  if (!fn) return { reads: 0, exprs: 0 };
  let reads = localReads(fn.body);
  let exprs = localExprs(fn.body);
  for (const c of callees(fn.body)) {
    const sub = cost(c, [...stack, name]);
    reads += sub.reads;
    exprs += sub.exprs;
  }
  const r = { reads, exprs };
  if (stack.length === 0) memo.set(name, r);
  return r;
}

// ---- 5. Cost of an arbitrary inline snippet (an allow statement) ---------
function snippetCost(snippet) {
  let reads = localReads(snippet);
  let exprs = localExprs(snippet);
  for (const c of callees(snippet)) {
    const sub = cost(c);
    reads += sub.reads;
    exprs += sub.exprs;
  }
  return { reads, exprs };
}

// ---- 6. Report -----------------------------------------------------------
const targets = process.argv.slice(2);
if (targets.length) {
  console.log('=== per-validator transitive cost ===');
  const rows = targets
    .filter((t) => fns.has(t))
    .map((t) => ({ name: t, line: fns.get(t).line, ...cost(t) }))
    .sort((a, b) => b.exprs - a.exprs);
  for (const r of rows) {
    console.log(
      `${String(r.exprs).padStart(6)} exprs  ${String(r.reads).padStart(3)} reads  L${String(r.line).padEnd(5)} ${r.name}`
    );
  }
}

// ---- 7. Cost of each allow statement -------------------------------------
console.log('\n=== allow-statement cost (fully expanded) ===');
const stmts = [];
for (let i = 0; i < lines.length; i++) {
  if (!/^\s*allow\s+[\w, ]+:\s*if/.test(lines[i])) continue;
  let stmt = '', j = i;
  while (j < lines.length) {
    stmt += lines[j] + '\n';
    if (/;\s*$/.test(lines[j])) break;
    j++;
  }
  stmts.push({ line: i + 1, ...snippetCost(stmt) });
}
stmts.sort((a, b) => b.exprs - a.exprs);
for (const s of stmts.slice(0, 15)) {
  const flag = s.exprs > 1000 ? '  <-- OVER BUDGET' : '';
  console.log(
    `${String(s.exprs).padStart(6)} exprs  ${String(s.reads).padStart(3)} reads  L${s.line}${flag}`
  );
}

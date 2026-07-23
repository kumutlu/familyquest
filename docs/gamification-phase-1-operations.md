# Gamification Phase 1 Operations Guide

> **For agentic workers:** This document covers deployment order, cutover procedures, rollback, and monitoring for the Stage 2 gamification system.

## Overview

The Stage 2 gamification system introduces server-authoritative XP, levels, streaks, Daily Goal, and Perfect Day tracking. This document provides operational procedures for deployment, cutover, rollback, and monitoring.

## Deployment Order

### 1. Pre-deployment Verification

Before any deployment, verify:

```bash
# Verify clean working tree
git status --short
test -z "$(git status --porcelain)"

# Verify all tests pass
npm test
npm --prefix functions test
npm --prefix functions run build
npx tsc -b --pretty false
npm run build
```

### 2. Rules Deployment

Deploy Firestore rules first to establish the security boundary:

```bash
# Deploy rules (no indexes required)
firebase deploy --only firestore:rules
```

**Important:** The gamification rules deny all client writes to:
- `task_occurrences`
- `gamification_events`
- `daily_eligibility`
- `daily_progress`
- `gamification_summaries`
- `gamification_checkpoints`

### 3. Functions Deployment

Deploy Cloud Functions after rules:

```bash
# Deploy functions
firebase deploy --only functions
```

The following functions are deployed:
- `onTaskCompletionWritten` - Processes approved task completions
- `onGamificationReversalCreated` - Processes reversals for task completions
- `finalizeGamificationDays` - Hourly scheduler for day finalization

### 4. Hosting Deployment

Deploy the client application last:

```bash
# Deploy hosting
firebase deploy --only hosting
```

## Migration Status Transitions

The gamification system uses a state machine for migration:

```
inactive → prepared → baseline_complete → active
```

### State Descriptions

| State | Description |
|-------|-------------|
| `inactive` | Default state. No gamification processing occurs. Task completions cannot be approved. |
| `prepared` | Migration prepared. Legacy XP baselines written. Task completions can be approved. |
| `baseline_complete` | All children have clean summaries. Post-cutover repair in progress. |
| `active` | Full gamification system active. All features enabled. |

### Migration Commands

```bash
# Prepare migration (dry-run)
npx tsx scripts/migrate-legacy-xp.ts --dry-run

# Execute migration
npx tsx scripts/migrate-legacy-xp.ts --execute
```

## Cutover Order

1. **Deploy Rules** - Establishes security boundary
2. **Deploy Functions** - Enables server processing
3. **Prepare Migration** - Sets `gamificationMigration.status = 'prepared'`
4. **Verify Baselines** - Confirm all children have clean summaries
5. **Advance to baseline_complete** - System advances automatically when all summaries are clean
6. **Run Post-Cutover Repair** - Processes any missed approvals
7. **Advance to active** - System advances automatically after repair boundary is drained

## Rollback Procedure

### If issues occur during migration:

1. **Stop the migration** - Do not advance to `baseline_complete`
2. **Revert migration state** (if needed):
   ```bash
   # Use Admin SDK to reset migration state
   # This is a manual operation via Firebase console or Admin SDK
   ```
3. **Redeploy previous rules** (if rules were changed)

### If issues occur after activation:

1. **Disable Functions** temporarily:
   ```bash
   firebase functions:delete onTaskCompletionWritten
   firebase functions:delete onGamificationReversalCreated
   firebase functions:delete finalizeGamificationDays
   ```
2. **Reset migration state** to `inactive` or `prepared`
3. **Investigate** using the monitoring queries below

## Repair/Rebuild Invocation

### Manual Rebuild Trigger

To rebuild a child's gamification summary:

```bash
# This is handled by the repairGamificationPage function
# Trigger via Firebase console or Admin SDK
```

### Missed Trigger Recovery

The system automatically handles missed triggers through:
- `repairPostCutoverPage` - Processes completions in the repair boundary
- Checkpoint-based resume - Continues from last processed record

## Monitoring and Failure Signals

### Key Metrics to Monitor

1. **Function Errors**
   ```bash
   # Check Cloud Functions logs
   firebase functions:log
   ```

2. **Migration Status**
   ```
   Query: families where gamificationMigration.status != 'inactive'
   Alert: If status remains 'prepared' for > 24 hours
   ```

3. **Dirty Summaries**
   ```
   Query: gamification_summaries where rebuildRequired == true
   Alert: If count > 0 for > 1 hour
   ```

4. **Checkpoint Documents**
   ```
   Query: gamification_checkpoints
   Alert: If documents exist for > 2 hours (indicates stuck rebuild)
   ```

5. **Event Integrity**
   ```
   Query: gamification_events where xpDelta < 0
   Alert: Unexpected negative XP events
   ```

### Common Failure Patterns

| Pattern | Indication | Action |
|---------|------------|--------|
| `ignored` status from processor | Completion not in approved state or pre-cutover | Verify completion status and cutover time |
| `duplicate` status | Same logical completion already processed | Expected behavior, no action needed |
| `processed` with no events | Zero eligible tasks or already-invalid source | Expected behavior |
| Transaction errors | Concurrent writes or validation failures | Check for conflicting writes |

## Post-Deployment Smoke-Test Checklist

After deployment, verify:

- [ ] Rules deployed successfully (`firebase deploy --only firestore:rules`)
- [ ] Functions deployed successfully (`firebase deploy --only functions`)
- [ ] Hosting deployed successfully (`firebase deploy --only hosting`)
- [ ] Migration state is `inactive` (default)
- [ ] No `gamification_checkpoints` exist
- [ ] No `gamification_summaries` have `rebuildRequired: true`
- [ ] Test manual task approval (should be ignored in `inactive` state)
- [ ] Test auto-approved task (should be ignored in `inactive` state)
- [ ] Verify no client can write to gamification collections

## Deployed-Build Verification Procedure

To verify the deployed build in production:

### 1. Verify Commit SHA

```bash
# Get the deployed commit SHA
firebase functions:log | grep "commit" | head -1

# Or check the build info in the deployed app
# The app should display build info in settings or via API
```

### 2. Verify Asset Hash

```bash
# Get deployed hosting version
firebase hosting:releases:list

# Verify the main JS bundle hash matches expected
curl -s https://your-app.web.app/assets/index-*.js | shasum -a 256
```

### 3. Verify Fix Commit Inclusion

```bash
# Check if a specific fix is included
git merge-base --is-ancestor <fix-commit> HEAD && echo "Fix included" || echo "Fix NOT included"
```

### 4. Verify Rules Version

```bash
# Download and verify deployed rules
firebase firestore:rules:get > deployed-rules.rules
diff firestore.rules deployed-rules.rules
```

## Security Model Summary

### Server-Only Collections

These collections are **never** client-writable:
- `task_occurrences` - Immutable occurrence reservations
- `gamification_events` - Immutable event ledger
- `daily_eligibility` - Immutable daily snapshots
- `daily_progress` - Derived progress (server writes only)
- `gamification_summaries` - Derived summaries (server writes only)
- `gamification_checkpoints` - Rebuild checkpoints (server writes only)

### Client-Allowed Operations

- Task completion create (status: `pending_approval` or `auto-approved`)
- Task completion update (status: `approved`, `rejected`, `cancelled`)
- Read own summary (child) or all summaries (parent)
- Read own daily progress (child) or all progress (parent)

### Security Invariants

1. Client cannot write `rewardPoints` or `lifetimeXP` on task completion
2. Client cannot create gamification events
3. Client cannot create eligibility snapshots
4. All gamification writes require migration state `prepared` or later
5. Cross-family and cross-child access is denied

## Index Requirements

**No new composite indexes are required** for Stage 2. The existing indexes in `firestore.indexes.json` are sufficient:

- `transfer_requests`: `fromChildId ASC, createdAt DESC`
- `petbox_requests`: `childId ASC, createdAt DESC`
- `profile_update_requests`: `childId ASC, createdAt DESC`
- `money_requests`: `requesterId ASC, createdAt DESC`
- `money_requests`: `requestedFromId ASC, createdAt DESC`
- `notifications`: `recipientIds CONTAINS, createdAt DESC`
- `push_tokens`: `enabled ASC, familyId ASC, userId ASC`

## Troubleshooting

### "Service call error" in Rules

This typically indicates:
- Non-deterministic document ID in a `getAfter()` call
- Missing document in the same batch
- Solution: Ensure all document IDs are deterministically addressable

### "Evaluation error" in Rules

This indicates the 1000-expression limit was exceeded:
- Check for deeply nested OR conditions
- Split validators into separate allow statements
- Use `hasOnly()` instead of multiple `in` checks

### Transaction Conflicts

- Retry with exponential backoff
- Check for concurrent writes to the same documents
- Verify no client is writing to server-only collections

## Accessibility Review

### Stage 2 UI Components

The following gamification UI components have been reviewed for accessibility:

#### GamificationSummaryCard (`src/components/dashboard/GamificationSummaryCard.tsx`)

**Accessibility Features:**
- Uses semantic HTML with Card/CardHeader/CardContent structure
- `aria-label` on XP progress percentage for screen reader context
- `aria-label` on XP total and XP to next level for screen reader context
- `aria-label` on today's progress percentage
- `aria-label` on Daily Goal status (Goal Reached/Goal in Progress)
- Icons from lucide-react (Flame, Star, CheckCircle2, Circle) provide visual context
- Color contrast meets WCAG standards (primary-500 background with white text)
- Loading/unavailable state clearly indicated with "Loading…" text

**Recommendations:**
- Implemented: `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` on Progress component (src/components/ui/Progress.tsx)
- Consider adding `aria-live="polite"` to the card for dynamic updates

#### ChildSummaryCard (`src/components/parent/dashboard/ChildSummaryCard.tsx`)

**Accessibility Features:**
- Link wrapper with `aria-label` for screen reader navigation context
- `focus-visible` ring styles for keyboard navigation
- `aria-label` on XP to next level text
- `aria-label` on today's progress percentage
- `aria-label` on Daily Goal status
- Visual indicators (icons) for streak and goal status
- Clear "Unavailable" state when summary is rebuilding

**Recommendations:**
- Consider adding `aria-describedby` to link the card description to the link

#### MemberProfile (`src/pages/MemberProfile.tsx`)

**Accessibility Features:**
- Level badge displayed as text with visual indicator
- Achievement gallery with clear locked/unlocked states
- History events with point delta indicators (positive/negative)
- ChevronLeft icon for back navigation
- Semantic section structure with headings

**Recommendations:**
- Consider adding `aria-label` to achievement cards for screen reader context


#### Progress Component (`src/components/ui/Progress.tsx`)

**Accessibility Features:**
- Visual progress bar with color coding
- Width-based visual representation
- `role="progressbar"` for screen reader semantics
- `aria-valuenow` for current value
- `aria-valuemin` and `aria-valuemax` for range
- Value clamping to 0-100% range

**Tests:**
- `src/components/ui/Progress.test.tsx` verifies ARIA attributes

### Accessibility Test Coverage

The `GamificationSummaryCard.test.tsx` file includes tests for:
- Screen-reader-friendly XP progress description (Progress.test.tsx)
- Screen-reader-friendly XP to next level description

### Summary

All Stage 2 UI components follow accessible patterns:
- Semantic HTML structure
- Proper ARIA labels for non-text content
- Keyboard navigation support
- Color contrast compliance
- Loading states with text indicators

## Contact

For production issues, check:
1. Firebase console logs
2. This operations guide
3. The design document: `docs/superpowers/specs/2026-07-22-gamification-phase-1-design.md`
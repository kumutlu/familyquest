# Family Data Audit — family `5s4Npeu55wPphLCsGAMP` (Umutlu)

Source export: `family-data-exports/family-5s4Npeu55wPphLCsGAMP-2026-07-14T08-49-43-880Z.json`
Audit performed: 2026-07-14. **No documents were modified or deleted** — this is a read-only audit with a proposed cleanup list for owner approval.

## Members
| uid | displayName | role |
|-----|-------------|------|
| 2OOwJPIs19PxyCyJbakVSNU1Zyv1 | Bilge Ümütlü | parent |
| bTEDZNNEQvZf67Y96bF2yxGNAry1 | Kemal | **owner** |
| NuyIJDP9fDNP2LiKynlsEyzur5N2 | Alin Asya Umutlu | child |
| T7ZsdaN8ixUOnzRAX9jNQqUDZE13 | Muhammed Osman | child |
| vc0iyHVfAcXnXQQbmFkr5HfJEkp2 | Mnalium | child |

## Tasks
| doc id | title | type | isActive | createdAt (epoch) | createdBy | assignedTo | feed entry | notes |
|--------|-------|------|----------|------------------|-----------|------------|------------|-------|
| FhaWrLx6ONEtD8bG3tXH | Turkish lesson with mother | daily | true | 1783798818 | — | — | `YPbIboKwHOuP1lV36jqE` "New task added: Turkish lesson with mother" (actorId: system) | OK |
| kTJa6D0cTVsiCjL6dYAA | Shower | weekly | true | 1783775315 | — | — | `CXE9icDHDARjSUcJi9tQ` "New task added: Shower" (actorId: system) | OK |
| RTUkA3WturcdMnlCqLCx | Brush Teeth | daily | true | **missing** | — | — | **none** | **SUSPECTED ORPHAN** — no createdAt, no feed entry; has 3 completions |
| SGafAENLttfXDQJf0u4S | Bike ride | daily | true | 1783807264 | — | — | `KQLU4fIAYT8wBgNbCmp6` "New task added: Bike ride" (actorId: system) | OK |

### Post-export duplicates (reported in screenshots, NOT in this export)
The following were created **after** the export (2026-07-14T08:49:43Z), almost certainly via the stale production bundle that used the old non-atomic `createTask` (task written via `addDoc` before a rejected `feed` write):
- `Brush teeth morning` (appears **twice** — duplicate)
- `Brush teeth evening`

These are not present in the export, so exact document IDs cannot be reported here. **Action: re-run `npm run data:export` to capture their IDs before cleanup.**

## Rewards
| doc id | title | cost | isActive | createdAt (epoch) | feed entry | notes |
|--------|-------|------|----------|------------------|------------|-------|
| OBqhLAOuBzPsO2i70pFs | 30 Minute Youtube | 50 | true | **missing** | **none** | **SUSPECTED ORPHAN** — no createdAt, no feed entry |
| VP6ZpHaGBGNlWTmIPCma | Tide your room | 50 | **false** (archived) | 1783770620 | `Qi7BgXPf2hvsGIJL7bt8` "New reward added: Tide your room" (actorId: system) | Intentional archive, OK |

## Proposed cleanup (for owner approval — do NOT auto-delete)
1. **Task `RTUkA3WturcdMnlCqLCx` "Brush Teeth"** — orphan (no createdAt/feed) but has 3 completions.
   - Recommendation: **soft-archive** (`isActive: false`) to preserve completion history, unless the owner wants it hard-deleted.
2. **Reward `OBqhLAOuBzPsO2i70pFs` "30 Minute Youtube"** — orphan (no createdAt/feed), still active.
   - Recommendation: **delete** (no dependents) or soft-archive.
3. **Duplicate "Brush teeth morning" (x2) + "Brush teeth evening"** — created via stale bundle.
   - Recommendation: after re-export, **delete the duplicate** "Brush teeth morning" and keep one canonical entry; keep/remove "Brush teeth evening" per owner preference.

## Notes
- No `createdBy` field is stored on tasks/rewards in this family, so authorship cannot be attributed from data alone.
- Historical `feed` entries use `actorId: "system"` for task/reward creation — consistent with the **old** non-atomic client path. The current source `createTask`/`createReward` write `actorId` = the authenticated UID, so new entries will be correctly attributed once the rebuilt bundle is deployed.

# Historical audit — Mnalium approved completions

Mode: **READ-ONLY**. No repair performed, no writes issued.
Source: `node scripts/audit-mnalium-history.cjs Mnalium` (production, `familyquest-beta-402cb`).
Generated: 2026-08-03T20:58Z.

## Subject

| Field | Value |
|---|---|
| Member id | `vc0iyHVfAcXnXQQbmFkr5HfJEkp2` |
| Family id | `5s4Npeu55wPphLCsGAMP` |
| `rewardPoints` (legacy wallet) | 370 |
| `lifetimeXP` (legacy) | 400 |
| `gamification_summaries.xpTotal` | 380 |
| Migration status | `baseline_complete` |
| `cutoverAt` | **2026-08-03T16:46:25.104Z** |
| `gamification_events` | 1 event, xpSum 380 (the baseline adoption event only) |
| Approved completions since account creation | **26** |

Two structural facts dominate the whole history:

1. **The gamification processor has never run for this member.** Not one completion
   carries `gamificationProcessedAt`, `gamificationProcessorVersion`, or any
   processing/error marker. Derived eras: `firstProcessedAt = null`,
   `sharedTaskFixAt = null`. There is therefore no "processor started then failed"
   case in this history — the processor never started, ever.
2. **Every task in this family has `assigneeId = null`** (shared / "All Children").
   So the `shared` column is true for all 26 rows and is only *discriminating* for
   completions approved after cutover.

## Why `effectSnapshot` is missing

Three distinct reasons, and only three:

- **Rows 1–2**: `effectSnapshot` is *present*. These were written by the old
  client-side award path (legacy era, before the processor existed).
- **Rows 3–25**: approved **before** `cutoverAt`. The migration adopted a baseline
  from legacy `lifetimeXP` and deliberately did not replay pre-cutover completions,
  so no per-completion snapshot was ever intended to exist.
- **Row 26**: approved **after** cutover (2026-08-03T19:46:45Z vs cutover
  16:46:25Z). This one *should* have been processed and was not: the task carries no
  `assigneeId`, which is the shared-task defect. The processor left no marker at all.

## Chronological table (all 26 approved completions)

| # | approvedAt (UTC) | Completion id | Task | Pts | effectSnapshot | Processor started | Pre-cutover | Shared task | Classification |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-07-14T22:20:58.128Z | `iTFohf5T6DADEqSsKZjJ` | Brush teeth evening | 10 | yes | no | yes | yes | already awarded |
| 2 | 2026-07-17T21:05:59.454Z | `CEwtMlz3EJEwjpMty4hd` | Shower | 20 | yes | no | yes | yes | already awarded |
| 3 | 2026-07-24T17:25:39.341Z | `…__xzSLSQeo0izEncCprMe8__2026-07-24` | Change your pajamas | 10 | no | no | yes | yes | ignored by migration |
| 4 | 2026-07-24T17:25:41.248Z | `…__vwTyJHofSG1IfLiJuMDc__2026-07-24` | Put pajamas in the drawer | 10 | no | no | yes | yes | ignored by migration |
| 5 | 2026-07-24T17:25:42.439Z | `…__wMoDwTOoUAkgqpjBtL6U__2026-07-24` | Brush teeth morning | 10 | no | no | yes | yes | ignored by migration |
| 6 | 2026-07-24T17:25:43.776Z | `…__UKDbDI9oLVlNOV1l2kEK__2026-07-24` | Brush teeth evening | 10 | no | no | yes | yes | ignored by migration |
| 7 | 2026-07-24T17:25:50.877Z | `…__fdCddt2CN5JdTqoVXTUF__week:2026-07-20` | Shower | 20 | no | no | yes | yes | ignored by migration |
| 8 | 2026-07-25T20:46:27.270Z | `…__UKDbDI9oLVlNOV1l2kEK__2026-07-25` | Brush teeth evening | 10 | no | no | yes | yes | ignored by migration |
| 9 | 2026-07-27T08:20:57.055Z | `…__UKDbDI9oLVlNOV1l2kEK__2026-07-27` | Brush teeth evening | 10 | no | no | yes | yes | ignored by migration |
| 10 | 2026-07-28T10:01:00.604Z | `…__fdCddt2CN5JdTqoVXTUF__week:2026-07-27` | Shower | 20 | no | no | yes | yes | ignored by migration |
| 11 | 2026-07-28T10:01:02.383Z | `…__xzSLSQeo0izEncCprMe8__2026-07-27` | Change your pajamas | 10 | no | no | yes | yes | ignored by migration |
| 12 | 2026-07-29T12:10:26.092Z | `…__UKDbDI9oLVlNOV1l2kEK__2026-07-29` | Brush teeth evening | 10 | no | no | yes | yes | ignored by migration |
| 13 | 2026-07-29T19:56:27.561Z | `…__fKCwPUjioqe8MwXlluQL__2026-07-29` | Make the bed | 20 | no | no | yes | yes | ignored by migration |
| 14 | 2026-07-30T13:17:07.874Z | `…__xzSLSQeo0izEncCprMe8__2026-07-30` | Change your pajamas | 10 | no | no | yes | yes | ignored by migration |
| 15 | 2026-07-31T09:39:02.348Z | `…__wMoDwTOoUAkgqpjBtL6U__2026-07-31` | Brush teeth morning | 10 | no | no | yes | yes | ignored by migration |
| 16 | 2026-07-31T11:47:08.503Z | `…__vwTyJHofSG1IfLiJuMDc__2026-07-31` | Put pajamas in the drawer | 10 | no | no | yes | yes | ignored by migration |
| 17 | 2026-07-31T11:47:08.795Z | `…__xzSLSQeo0izEncCprMe8__2026-07-31` | Change your pajamas | 10 | no | no | yes | yes | ignored by migration |
| 18 | 2026-07-31T15:46:27.050Z | `…__fKCwPUjioqe8MwXlluQL__2026-07-31` | Make the bed | 20 | no | no | yes | yes | ignored by migration |
| 19 | 2026-08-02T10:59:37.767Z | `…__UKDbDI9oLVlNOV1l2kEK__2026-08-02` | Brush teeth evening | 10 | no | no | yes | yes | ignored by migration |
| 20 | 2026-08-03T10:42:27.809Z | `…__xzSLSQeo0izEncCprMe8__2026-08-02` | Change your pajamas | 10 | no | no | yes | yes | ignored by migration |
| 21 | 2026-08-03T10:42:28.424Z | `…__wMoDwTOoUAkgqpjBtL6U__2026-08-02` | Brush teeth morning | 10 | no | no | yes | yes | ignored by migration |
| 22 | 2026-08-03T10:49:08.860Z | `…__xzSLSQeo0izEncCprMe8__2026-08-03` | Change your pajamas | 10 | no | no | yes | yes | ignored by migration |
| 23 | 2026-08-03T10:49:10.328Z | `…__fdCddt2CN5JdTqoVXTUF__week:2026-08-03` | Shower | 20 | no | no | yes | yes | ignored by migration |
| 24 | 2026-08-03T16:01:58.148Z | `…__B0b2snC88SYiZGnMPvJa__2026-08-03` | House Vacuum | 40 | no | no | yes | yes | ignored by migration |
| 25 | 2026-08-03T16:01:59.340Z | `…__u1KJkDnLHxBJCoLJyNEN__2026-08-03` | Help parent | 25 | no | no | yes | yes | ignored by migration |
| 26 | 2026-08-03T19:46:45.038Z | `…__c3WmeyXGkvhwVe7mWTiq__2026-08-03` | Riding bike 30 miny | 20 | no | no | **no** | yes | **shared-task bug** |

(`…` = the member id prefix `vc0iyHVfAcXnXQQbmFkr5HfJEkp2`.)

## Totals

| Classification | Count |
|---|---|
| already awarded | 2 |
| ignored by migration | 23 |
| shared-task bug | 1 |
| processor failed | 0 |
| behaviour bug | 0 |
| unknown | 0 |

## Era boundaries as evidenced by the data

- **Old client-award era**: rows 1–2 (2026-07-14 → 2026-07-17). Identified by the
  presence of a legacy `effectSnapshot` and the absence of any processor field or
  deterministic composite id.
- **Deterministic-id / pre-cutover era**: rows 3–25 (2026-07-24 → 2026-08-03 16:01Z).
  Completion ids switched to `member__task__period`. No award artefacts; these sit
  behind the migration baseline.
- **Post-cutover era**: row 26 only, everything after 2026-08-03T16:46:25.104Z.

## Caveats on the "historical truth"

1. `lifetimeXP` = 400 but `xpTotal` = 380 — a 20-point divergence that predates
   cutover and is *not* explained by any of the 26 rows individually. The baseline
   adoption event recorded 380, so the 20 difference sits inside the legacy
   `lifetimeXP` value itself.
2. "ignored by migration" is a statement of mechanism, not of loss. Whether those 23
   completions are economically represented depends on whether the legacy
   `lifetimeXP`/`rewardPoints` totals already absorbed them at approval time; the
   completion documents themselves carry no award evidence either way, so this is the
   limit of what the data can prove.
3. Only row 26 is unambiguously an unpaid post-cutover award.

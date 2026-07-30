# Task Visibility Investigation Report

## Executive Summary
**Root Cause Identified:** The `Tasks.tsx` page does NOT filter tasks by `assigneeId` for child users. All family tasks are visible to all children, regardless of assignment.

---

## 1. Firestore Task Document Structure

From `backups/pre-deploy-5dda1f6/family-5s4Npeu55wPphLCsGAMP-2026-07-19T14-10-56-454Z.json`:

```json
{
  "id": "UKDbDI9oLVlNOV1l2kEK",
  "data": {
    "title": "Brush teeth evening",
    "pointsReward": 10,
    "type": "daily",
    "requiresApproval": true,
    "assigneeId": null,  // ← null = "All Children" / shared task
    "isActive": true,
    "createdAt": { "seconds": 1784059723, "nanoseconds": 699000000 }
  }
}
```

**Key Fields:**
- `assigneeId: string | null` - When `null`, task is shared with all children. When set to a child ID, task is assigned to that specific child.
- `isActive: boolean` - Controls task visibility
- `type: 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'one-time' | 'custom'`

---

## 2. Store Task Object

From `src/store/useStore.ts` line 658:

```typescript
subscribePlanned('tasks', 'Tasks', snapshot => set({ tasks: docs(snapshot) }));
```

**Observation:** Tasks are stored as-is from Firestore. No client-side filtering occurs during data loading.

---

## 3. Task List Before Filtering (Tasks.tsx)

From `src/pages/Tasks.tsx` line 17:

```typescript
const { currentUser, tasks, taskCompletions, loading } = useStore();
```

**State:** `tasks` contains ALL tasks in the family (parent and child both receive the same unfiltered list).

---

## 4. Task List After Filtering (Tasks.tsx)

### Filter 1 - Active Tasks Only (line 35):
```typescript
const activeTasks = tasks.filter(t => t.isActive !== false);
```
- Filters: `isActive !== false`
- **Does NOT filter by `assigneeId`**

### Filter 2 - Type Filter (line 51):
```typescript
const filteredTasks = filter === 'all' ? mappedTasks : mappedTasks.filter(t => t.type === filter);
```
- Filters: `type === filter` (daily, weekdays, etc.)
- **Does NOT filter by `assigneeId`**

### Mapping with Availability (lines 41-49):
```typescript
const mappedTasks = activeTasks.map(task => {
  const av = deriveTaskAvailability(task, taskCompletions, now, currentUser?.id);
  return {
    ...task,
    status: av.status,
    completionId: av.completionId,
    available: av.available,
  };
});
```
- `deriveTaskAvailability` in `src/lib/taskRecurrence.ts` (line 182-223) uses `assigneeId` to match completions, but does NOT filter the task list itself.

---

## 5. Line that SHOULD Filter by assigneeId

**There is NO such line in Tasks.tsx.**

The expected filtering logic (based on `TaskSummaryCard.tsx` and `ChildrenOverview.tsx`) should be:

```typescript
const visibleTasks = tasks.filter(t => 
  t.isActive !== false && 
  (!t.assigneeId || t.assigneeId === currentUser?.id)
);
```

---

## 6. Root Cause: Missing assigneeId Filtering

### Evidence:

1. **TaskSummaryCard.tsx** (line 29-31) - CORRECTLY filters:
   ```typescript
   const active = (tasks || []).filter(
     t => t.isActive !== false && (!t.assigneeId || t.assigneeId === uid),
   );
   ```

2. **ChildrenOverview.tsx** (line 95-100) - CORRECTLY filters:
   ```typescript
   const pendingTaskCount = tasks.filter(
     task =>
       task.isActive !== false &&
       task.assigneeId === child.id &&
       !isTaskDoneThisPeriod(task, taskCompletions, now, child.id),
   ).length;
   ```

3. **Tasks.tsx** - MISSING the `assigneeId` filter entirely.

---

## 7. "All Children" Behavior Verification

From `src/components/forms/TaskFormModal.tsx` (line 123-129):

```tsx
<label className="block text-sm font-medium text-gray-700">{t('tasks:form.assignedChild')}</label>
<select value={formData.assigneeId} onChange={e => setFormData({...formData, assigneeId: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
  <option value="">{t('tasks:form.anyoneShared')}</option>  // ← "All Children" option
  {familyMembers.filter(m => m.role === 'child').map(child => (
    <option key={child.id} value={child.id}>{child.displayName}</option>
  ))}
</select>
```

**Design Intent:**
- `assigneeId: null` or `assigneeId: ""` → "All Children" (shared task, visible to everyone)
- `assigneeId: "childId"` → Assigned to specific child

**From `docs/superpowers/specs/2026-07-22-gamification-phase-1-design.md` (line 169):**
> "Unassigned-task ownership. A task with no `assigneeId` is eligible for nobody until assigned. Only tasks explicitly assigned to a child are eligible for that child."

**Note:** This design document states the OPPOSITE of the current implementation - it says unassigned tasks should NOT be eligible. However, the current code in `TaskSummaryCard.tsx` and `ChildrenOverview.tsx` treats `null` assigneeId as "shared with all children."

---

## 8. Runtime Flow Summary

```
1. Firestore: families/{familyId}/tasks collection
   - All tasks readable by any family member (firestore.rules line 1519-1522)
   
2. useStore.ts: loadFamilyData()
   - Line 658: subscribePlanned('tasks', ...) → ALL tasks stored in state
   
3. Tasks.tsx: Rendering
   - Line 35: Filter `isActive !== false` only
   - Line 51: Filter by `type` only
   - NO filtering by `assigneeId`
   
4. Result: Every child sees every task in the family
```

---

## 9. Fix Required

In `src/pages/Tasks.tsx`, add `assigneeId` filtering for child users:

```typescript
// After line 35, add:
const visibleTasks = currentUser?.role === 'child'
  ? activeTasks.filter(t => !t.assigneeId || t.assigneeId === currentUser.id)
  : activeTasks;
```

Then use `visibleTasks` instead of `activeTasks` for the type filtering and rendering.

---

## 10. Files Analyzed

| File | Finding |
|------|---------|
| `src/pages/Tasks.tsx` | **Missing assigneeId filter** - root cause |
| `src/store/useStore.ts` | No filtering during data load (correct) |
| `src/lib/bootstrapQueries.ts` | Tasks query has no `where` clause (line 170) - all tasks fetched |
| `src/lib/taskRecurrence.ts` | Uses assigneeId for completion matching, not task filtering |
| `src/components/dashboard/TaskSummaryCard.tsx` | Correctly filters by assigneeId |
| `src/components/parent/dashboard/ChildrenOverview.tsx` | Correctly filters by assigneeId |
| `src/components/forms/TaskFormModal.tsx` | UI for assigning tasks to specific child or "All Children" |
| `firestore.rules` | All family members can read all tasks (line 1519-1522) |
| `docs/superpowers/specs/2026-07-22-gamification-phase-1-design.md` | Design spec for task assignment behavior |
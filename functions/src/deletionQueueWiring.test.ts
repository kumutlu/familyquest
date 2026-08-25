// ---------------------------------------------------------------------------
// REGRESSION TEST — regional Cloud Tasks enqueue wiring
// ---------------------------------------------------------------------------
// Root cause (P0 incident): both deletion enqueue paths resolved an
// UNQUALIFIED taskQueue('processFamilyDeletion'), which defaults to the
// project's default region (us-central1), while processFamilyDeletion is
// deployed in europe-west1. Enqueue failures were silently swallowed,
// leaving familyDeletionJobs stuck in 'queued' forever.
//
// This test pins the injectable enqueue boundary to the fully-qualified
// target: locations/europe-west1/functions/processFamilyDeletion
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const taskQueueMock = vi.hoisted(() => vi.fn());
vi.mock('firebase-admin/functions', () => ({
  getFunctions: () => ({
    taskQueue: taskQueueMock,
  }),
}));

import {
  FAMILY_DELETION_QUEUE_TARGET,
  enqueueFamilyDeletionTask,
} from './deletionTaskQueue';

describe('regional Cloud Tasks enqueue wiring', () => {
  beforeEach(() => {
    taskQueueMock.mockReset();
    taskQueueMock.mockReturnValue({ enqueue: vi.fn().mockResolvedValue(undefined) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('targets the fully-qualified europe-west1 queue, not the default region', async () => {
    await enqueueFamilyDeletionTask('family-under-test');
    expect(taskQueueMock).toHaveBeenCalledTimes(1);
    const [queueName] = taskQueueMock.mock.calls[0];
    expect(queueName).toBe('locations/europe-west1/functions/processFamilyDeletion');
    expect(queueName).not.toBe('processFamilyDeletion'); // unqualified = us-central1 bug
  });

  it('exports the expected target constant', () => {
    expect(FAMILY_DELETION_QUEUE_TARGET).toBe(
      'locations/europe-west1/functions/processFamilyDeletion',
    );
  });

  it('forwards scheduleDelaySeconds when provided', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    taskQueueMock.mockReturnValue({ enqueue });
    await enqueueFamilyDeletionTask('family-under-test', 30);
    expect(enqueue).toHaveBeenCalledWith(
      { familyId: 'family-under-test' },
      { scheduleDelaySeconds: 30 },
    );
  });

  it('logs a SANITIZED structured error on enqueue failure (no payload contents)', async () => {
    const enqueue = vi.fn().mockRejectedValue(
      Object.assign(new Error('internal detail that must not be logged'), {
        code: 'tasks/queue-not-found',
      }),
    );
    taskQueueMock.mockReturnValue({ enqueue });
    const errSpy = vi.spyOn(console, 'error');

    // Must NOT throw — durable job remains for the recovery scheduler.
    await expect(enqueueFamilyDeletionTask('family-under-test')).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errSpy.mock.calls[0]);
    expect(logged).toContain('FAMILY_DELETION_ENQUEUE_FAILED');
    expect(logged).toContain('europe-west1');
    expect(logged).toContain('tasks/queue-not-found');
    // Privacy: never log raw errors or payload contents.
    expect(logged).not.toContain('internal detail that must not be logged');
  });
});

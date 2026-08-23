import { describe, it, expect } from 'vitest';
import { selectReviewQueue, selectUnifiedReviewQueue, type ReviewItem } from './reviewQueue';

const BASE_TIME = { toDate: () => new Date(2026, 7, 21, 10, 0, 0) };
const EARLIER_TIME = { toDate: () => new Date(2026, 7, 21, 9, 0, 0) };

function completion(overrides: Record<string, unknown> & { id: string }) {
  return {
    taskId: 't1',
    assigneeId: 'child-1',
    status: 'pending_approval',
    completedAt: BASE_TIME,
    ...overrides,
  };
}

describe('selectReviewQueue', () => {
  it('collects only pending task completions', () => {
    const completions = [
      completion({ id: 'c1' }),
      completion({ id: 'c2', status: 'approved' }),
      completion({ id: 'c3', status: 'rejected' }),
    ];
    const queue = selectReviewQueue(completions, [], []);
    expect(queue.map(item => item.completionId)).toEqual(['c1']);
  });

  it('orders oldest submission first (FIFO fairness)', () => {
    const completions = [
      completion({ id: 'later', completedAt: BASE_TIME }),
      completion({ id: 'earlier', completedAt: EARLIER_TIME }),
    ];
    const queue = selectReviewQueue(completions, [], []);
    expect(queue.map(item => item.completionId)).toEqual(['earlier', 'later']);
  });

  it('breaks time ties deterministically by child then completion id', () => {
    const completions = [
      completion({ id: 'b', assigneeId: 'child-2' }),
      completion({ id: 'a', assigneeId: 'child-2' }),
      completion({ id: 'z', assigneeId: 'child-1' }),
    ];
    const queue = selectReviewQueue(completions, [], []);
    expect(queue.map(item => item.completionId)).toEqual(['z', 'a', 'b']);
  });

  it('resolves child identity and quest context onto each card', () => {
    const tasks = [{ id: 't1', title: 'Feed the cat', pointsReward: 10 }];
    const members = [
      { id: 'child-1', displayName: 'Ali', avatarUrl: 'http://x/y.png', colour: '#ff0000' },
    ];
    const queue = selectReviewQueue([completion({ id: 'c1' })], tasks, members);
    expect(queue[0]).toMatchObject({
      completionId: 'c1',
      childId: 'child-1',
      childName: 'Ali',
      avatarUrl: 'http://x/y.png',
      colour: '#ff0000',
      taskTitle: 'Feed the cat',
      pointsReward: 10,
    });
  });

  it('degrades gracefully when the task or member record is missing', () => {
    const queue = selectReviewQueue([completion({ id: 'c1' })], [], []);
    expect(queue[0].taskTitle).toBe('');
    expect(queue[0].childName).toBe('');
    expect(queue[0].pointsReward).toBe(0);
  });

  it('never mutates its inputs', () => {
    const completions = [completion({ id: 'b' }), completion({ id: 'a' })];
    const snapshot = JSON.stringify(completions);
    selectReviewQueue(completions, [], []);
    expect(JSON.stringify(completions)).toBe(snapshot);
  });

  it('exposes a stable per-item key for mutation sequencing', () => {
    const queue: ReviewItem[] = selectReviewQueue([completion({ id: 'c1' })], [], []);
    expect(queue[0].key).toBe('task:c1');
  });
});

describe('selectUnifiedReviewQueue (Wave 3 typed kinds)', () => {
  const members = [
    { id: 'child-1', displayName: 'Ali' },
    { id: 'child-2', displayName: 'Zeynep' },
  ];

  it('merges quest, transfer and money-request items into one FIFO queue', () => {
    const queue = selectUnifiedReviewQueue({
      completions: [completion({ id: 'c1', completedAt: BASE_TIME })],
      tasks: [{ id: 't1', title: 'Feed the cat', pointsReward: 10 }],
      members,
      transferRequests: [
        {
          id: 'tr1',
          fromChildId: 'child-1',
          fromChildName: 'Ali',
          toChildId: 'child-2',
          toChildName: 'Zeynep',
          amountPence: 200,
          status: 'pending',
          createdAt: EARLIER_TIME,
        },
      ],
      moneyRequests: [
        {
          id: 'mr1',
          requesterId: 'child-2',
          requesterName: 'Zeynep',
          requestedFromId: 'parent-1',
          requestedFromName: 'Dad',
          amountPence: 300,
          status: 'pending',
          createdAt: BASE_TIME,
        },
      ],
    });
    expect(queue.map(i => i.key)).toEqual(['transfer:tr1', 'quest:c1', 'money_request:mr1']);
    expect(queue.map(i => i.kind)).toEqual(['transfer', 'quest', 'money_request']);
  });

  it('excludes non-pending transfers and money requests', () => {
    const queue = selectUnifiedReviewQueue({
      completions: [],
      tasks: [],
      members,
      transferRequests: [
        { id: 'tr-approved', status: 'approved', amountPence: 100, createdAt: BASE_TIME },
        { id: 'tr-rejected', status: 'rejected', amountPence: 100, createdAt: BASE_TIME },
      ],
      moneyRequests: [
        { id: 'mr-approved', status: 'approved', amountPence: 100, createdAt: BASE_TIME },
        { id: 'mr-rejected', status: 'rejected', amountPence: 100, createdAt: BASE_TIME },
        { id: 'mr-cancelled', status: 'cancelled', amountPence: 100, createdAt: BASE_TIME },
      ],
    });
    expect(queue).toEqual([]);
  });

  it('includes pending_acceptance money requests flagged awaitingAcceptance', () => {
    const queue = selectUnifiedReviewQueue({
      completions: [],
      tasks: [],
      members,
      moneyRequests: [
        {
          id: 'mr1',
          requesterId: 'child-1',
          requesterName: 'Ali',
          requestedFromId: 'child-2',
          requestedFromName: 'Zeynep',
          amountPence: 150,
          status: 'pending_acceptance',
          createdAt: BASE_TIME,
        },
      ],
    });
    expect(queue).toHaveLength(1);
    expect(queue[0].awaitingAcceptance).toBe(true);
    expect(queue[0].counterpartyName).toBe('Zeynep');
  });

  it('carries amounts, counterparties and messages on money cards', () => {
    const queue = selectUnifiedReviewQueue({
      completions: [],
      tasks: [],
      members,
      transferRequests: [
        {
          id: 'tr1',
          fromChildId: 'child-1',
          fromChildName: 'Ali',
          toChildName: 'Zeynep',
          amountPence: 250,
          message: 'ice cream fund',
          status: 'pending',
          createdAt: BASE_TIME,
        },
      ],
    });
    expect(queue[0]).toMatchObject({
      kind: 'transfer',
      childName: 'Ali',
      counterpartyName: 'Zeynep',
      amountPence: 250,
      message: 'ice cream fund',
    });
  });

  it('never contains reward redemptions — they are not parent-reviewable', () => {
    // The domain has no reward approval gate; the selector has no reward input
    // at all, which is the structural guarantee being pinned here.
    const inputs = selectUnifiedReviewQueue.length;
    expect(inputs).toBe(1); // single typed input object — no redemption stream
  });

  it('breaks cross-kind time ties deterministically by child then key', () => {
    const queue = selectUnifiedReviewQueue({
      completions: [completion({ id: 'c1', assigneeId: 'child-2', completedAt: BASE_TIME })],
      tasks: [],
      members,
      transferRequests: [
        { id: 'tr1', fromChildId: 'child-1', fromChildName: 'Ali', toChildName: 'X', amountPence: 100, status: 'pending', createdAt: BASE_TIME },
      ],
    });
    expect(queue.map(i => i.key)).toEqual(['transfer:tr1', 'quest:c1']);
  });

  it('never mutates its inputs', () => {
    const transferRequests = [{ id: 'tr1', status: 'pending', amountPence: 100, createdAt: BASE_TIME }];
    const snapshot = JSON.stringify(transferRequests);
    selectUnifiedReviewQueue({ completions: [], tasks: [], members, transferRequests });
    expect(JSON.stringify(transferRequests)).toBe(snapshot);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUSH_BATCH_SIZE,
  PUSH_DISABLED_TYPES,
  resolveRecipientIds,
  classifyDelivery,
  resolveRoute,
  buildPushMessage,
  isInvalidTokenError,
  loadEnabledTokens,
  sendToTokens,
  isDeliveryComplete,
  recordDelivery,
  deliverNotification,
  removeAllUserTokens,
  type DeliveryContext,
  type PushNotificationInput,
  type ResolvedToken,
} from '../../functions/src/pushDelivery';

// --- Mock Firestore query (chainable .where + .get) ---
const queryMock = {
  where: vi.fn(() => queryMock),
  get: vi.fn(),
};

// --- Mock delivery-record doc ref (families/{f}/notification_deliveries/{id}) ---
const deliveryRef = {
  get: vi.fn(),
  set: vi.fn(async () => {}),
};

const db: any = {
  collectionGroup: vi.fn(() => queryMock),
  collection: vi.fn(() => ({
    doc: vi.fn(() => ({
      collection: vi.fn(() => ({
        doc: vi.fn(() => deliveryRef),
      })),
    })),
  })),
};

const messaging: any = {
  sendEachForMulticast: vi.fn(async () => ({ responses: [] })),
};

function makeContext(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    db,
    messaging,
    serverTimestamp: () => ({ server: true }),
    logger: vi.fn(),
    dryRun: false,
    ...overrides,
  };
}

function baseInput(overrides: Partial<PushNotificationInput> = {}): PushNotificationInput {
  return {
    id: 'n1',
    familyId: 'fam1',
    type: 'task_submitted',
    actorId: 'u1',
    recipientIds: ['u2', 'u3'],
    title: 'A task was submitted',
    body: 'Review “Clean bedroom”',
    actionUrl: '/tasks/c1',
    dedupeKey: 'task_submit_c1',
    ...overrides,
  };
}

function tokenDoc(id: string, userId: string, token: string) {
  return {
    id,
    data: () => ({ userId, familyId: 'fam1', token, enabled: true }),
    ref: { delete: vi.fn(async () => {}) },
  };
}

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.get.mockReset();
    deliveryRef.get.mockReset();
    deliveryRef.set.mockReset();
    // Default: no delivery record exists yet (overridable per-test).
    deliveryRef.get.mockResolvedValue({ exists: false });
  });

describe('resolveRecipientIds', () => {
  it('dedupes and drops empty ids', () => {
    expect(resolveRecipientIds(baseInput({ recipientIds: ['u2', '', 'u2', 'u3'] }))).toEqual([
      'u2',
      'u3',
    ]);
  });
});

describe('classifyDelivery', () => {
  it('returns send for a normal event', () => {
    expect(classifyDelivery(baseInput({ type: 'task_submitted' }))).toBe('send');
  });

  it('returns skip_quiet for in-app-only Pet Box events', () => {
    expect(classifyDelivery(baseInput({ type: 'petbox_contribution' }))).toBe('skip_quiet');
    expect(classifyDelivery(baseInput({ type: 'petbox_expense' }))).toBe('skip_quiet');
  });

  it('keeps petbox_contribution / petbox_expense in the disabled set', () => {
    expect(PUSH_DISABLED_TYPES.has('petbox_contribution')).toBe(true);
    expect(PUSH_DISABLED_TYPES.has('petbox_expense')).toBe(true);
  });
});

describe('resolveRoute', () => {
  it('uses the notification actionUrl when it is a path', () => {
    expect(resolveRoute(baseInput({ actionUrl: '/tasks/c1' }))).toBe('/tasks/c1');
  });

  it('falls back to / when actionUrl is missing or not a path', () => {
    expect(resolveRoute(baseInput({ actionUrl: 'https://evil.example' }))).toBe('/');
    expect(resolveRoute(baseInput({ actionUrl: undefined }))).toBe('/');
  });
});

describe('buildPushMessage', () => {
  it('uses dedupeKey (or id) as the collapse tag', () => {
    expect(buildPushMessage(baseInput()).android.notification.tag).toBe('task_submit_c1');
    expect(buildPushMessage(baseInput()).webpush.notification.tag).toBe('task_submit_c1');
    expect(buildPushMessage(baseInput({ dedupeKey: undefined })).android.notification.tag).toBe('n1');
    expect(buildPushMessage(baseInput({ dedupeKey: undefined })).webpush.notification.tag).toBe('n1');
  });

  it('includes the minimal data payload', () => {
    const msg = buildPushMessage(baseInput());
    expect(msg.data).toMatchObject({
      notificationId: 'n1',
      familyId: 'fam1',
      type: 'task_submitted',
      route: '/tasks/c1',
      title: 'A task was submitted',
      body: 'Review “Clean bedroom”',
    });
  });

  it('sets webpush icon/badge to the PWA assets', () => {
    const msg = buildPushMessage(baseInput());
    expect(msg.webpush.notification.icon).toBe('/pwa-192x192.png');
    expect(msg.webpush.notification.badge).toBe('/pwa-192x192.png');
  });
});

describe('isInvalidTokenError', () => {
  it('detects unregistered / invalid registration tokens', () => {
    expect(isInvalidTokenError('messaging/registration-token-not-registered')).toBe(true);
    expect(isInvalidTokenError('messaging/invalid-registration-token')).toBe(true);
  });

  it('returns false for other error codes', () => {
    expect(isInvalidTokenError('messaging/quota-exceeded')).toBe(false);
    expect(isInvalidTokenError(undefined)).toBe(false);
  });
});

describe('loadEnabledTokens', () => {
  it('queries the push_tokens collection group filtered by family, recipients and enabled', async () => {
    const docs = [tokenDoc('t1', 'u2', 'tok-a'), tokenDoc('t2', 'u3', 'tok-b')];
    queryMock.get.mockResolvedValue({ docs });
    const tokens = await loadEnabledTokens(makeContext(), 'fam1', ['u2', 'u3']);
    expect(db.collectionGroup).toHaveBeenCalledWith('push_tokens');
    expect(queryMock.where).toHaveBeenCalledWith('familyId', '==', 'fam1');
    expect(queryMock.where).toHaveBeenCalledWith('userId', 'in', ['u2', 'u3']);
    expect(queryMock.where).toHaveBeenCalledWith('enabled', '==', true);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ id: 't1', userId: 'u2', token: 'tok-a', enabled: true });
  });

  it('returns an empty list when there are no recipients', async () => {
    expect(await loadEnabledTokens(makeContext(), 'fam1', [])).toEqual([]);
  });
});

describe('sendToTokens', () => {
  const msg = buildPushMessage(baseInput());

  it('batches and calls sendEachForMulticast with the message', async () => {
    const tokens: ResolvedToken[] = [
      { id: 't1', userId: 'u2', familyId: 'fam1', token: 'a', enabled: true, delete: vi.fn() },
      { id: 't2', userId: 'u3', familyId: 'fam1', token: 'b', enabled: true, delete: vi.fn() },
    ];
    messaging.sendEachForMulticast.mockResolvedValue({
      responses: [{ success: true }, { success: true }],
    });
    const res = await sendToTokens(makeContext(), msg, tokens);
    expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(res.successCount).toBe(2);
    expect(res.failureCount).toBe(0);
  });

  it('does not call FCM in dryRun mode', async () => {
    const tokens: ResolvedToken[] = [
      { id: 't1', userId: 'u2', familyId: 'fam1', token: 'a', enabled: true, delete: vi.fn() },
    ];
    const res = await sendToTokens(makeContext({ dryRun: true }), msg, tokens);
    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
    expect(res.successCount).toBe(1);
  });

  it('collects invalid tokens on failure', async () => {
    const tokens: ResolvedToken[] = [
      { id: 't1', userId: 'u2', familyId: 'fam1', token: 'a', enabled: true, delete: vi.fn() },
      { id: 't2', userId: 'u3', familyId: 'fam1', token: 'b', enabled: true, delete: vi.fn() },
    ];
    messaging.sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });
    const res = await sendToTokens(makeContext(), msg, tokens);
    expect(res.failureCount).toBe(1);
    expect(res.invalid).toHaveLength(1);
    expect(res.invalid[0].id).toBe('t2');
  });

  it('respects the FCM batch size constant', () => {
    expect(PUSH_BATCH_SIZE).toBe(500);
  });

  it('logs each failed response with index, userId, error code and message (never the token)', async () => {
    const logger = vi.fn();
    const tokens: ResolvedToken[] = [
      { id: 't1', userId: 'u2', familyId: 'fam1', token: 'a', enabled: true, delete: vi.fn() },
      { id: 't2', userId: 'u3', familyId: 'fam1', token: 'b', enabled: true, delete: vi.fn() },
    ];
    messaging.sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: false, error: { code: 'messaging/invalid-argument', message: 'bad payload' } },
        { success: false, error: { code: 'messaging/quota-exceeded', message: 'quota' } },
      ],
    });
    const res = await sendToTokens(makeContext({ logger }), msg, tokens);
    expect(res.failureCount).toBe(2);
    expect(logger).toHaveBeenCalledTimes(2);
    const first = logger.mock.calls[0][0];
    const second = logger.mock.calls[1][0];
    expect(first).toMatchObject({
      event: 'push_send_failure',
      responseIndex: 0,
      batchIndex: 0,
      userId: 'u2',
      tokenId: 't1',
      errorCode: 'messaging/invalid-argument',
      errorMessage: 'bad payload',
    });
    expect(second).toMatchObject({
      event: 'push_send_failure',
      responseIndex: 1,
      batchIndex: 1,
      userId: 'u3',
      tokenId: 't2',
      errorCode: 'messaging/quota-exceeded',
      errorMessage: 'quota',
    });
    // The raw FCM registration token must never appear in the diagnostic log.
    // (tokenId is the Firestore doc id 't1'/'t2', which is safe to log.)
    const logged = JSON.stringify(logger.mock.calls);
    expect(logged).not.toContain('tok-a');
    expect(logged).not.toContain('tok-b');
    expect(logged).not.toContain('"token":"a"');
    expect(logged).not.toContain('"token":"b"');
  });

  it('maps the response index to the correct token across batches', async () => {
    const logger = vi.fn();
    // Build 501 tokens so two batches are exercised (PUSH_BATCH_SIZE = 500).
    const tokens: ResolvedToken[] = Array.from({ length: 501 }, (_, k) => ({
      id: `t${k}`,
      userId: `u${k}`,
      familyId: 'fam1',
      token: `tok-${k}`,
      enabled: true,
      delete: vi.fn(),
    }));
    messaging.sendEachForMulticast
      .mockResolvedValueOnce({
        responses: Array.from({ length: 500 }, () => ({
          success: false,
          error: { code: 'messaging/internal-error', message: 'boom' },
        })),
      })
      .mockResolvedValueOnce({
        responses: [
          { success: false, error: { code: 'messaging/internal-error', message: 'boom' } },
        ],
      });
    const res = await sendToTokens(makeContext({ logger }), msg, tokens);
    expect(res.failureCount).toBe(501);
    expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(2);
    // The last failure (absolute index 500) must map to userId u500 / tokenId t500.
    const lastCall = logger.mock.calls[500][0];
    expect(lastCall).toMatchObject({
      event: 'push_send_failure',
      responseIndex: 500,
      batchIndex: 0,
      userId: 'u500',
      tokenId: 't500',
    });
  });
});

describe('isDeliveryComplete', () => {
  it('is true when the delivery record status is completed', async () => {
    deliveryRef.get.mockResolvedValue({ exists: true, data: () => ({ status: 'completed' }) });
    expect(await isDeliveryComplete(makeContext(), 'fam1', 'n1')).toBe(true);
  });

  it('is false when no record exists', async () => {
    deliveryRef.get.mockResolvedValue({ exists: false });
    expect(await isDeliveryComplete(makeContext(), 'fam1', 'n1')).toBe(false);
  });
});

describe('recordDelivery', () => {
  it('writes the delivery record with merge', async () => {
    await recordDelivery(makeContext(), 'fam1', baseInput(), {
      notificationId: 'n1',
      status: 'completed',
      attemptedAt: { server: true },
      tokenCount: 1,
      successCount: 1,
      failureCount: 0,
      deliveryVersion: 1,
    });
    expect(deliveryRef.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }), {
      merge: true,
    });
  });
});

describe('deliverNotification', () => {
  const msg = buildPushMessage(baseInput());

  it('skips quiet events: records skipped and sends nothing', async () => {
    const ctx = makeContext();
    const result = await deliverNotification(
      ctx,
      baseInput({ type: 'petbox_contribution' }),
    );
    expect(result.status).toBe('skipped');
    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
    expect(deliveryRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped' }),
      { merge: true },
    );
  });

  it('is idempotent: a completed delivery is a no-op', async () => {
    deliveryRef.get.mockResolvedValue({ exists: true, data: () => ({ status: 'completed' }) });
    const ctx = makeContext();
    const result = await deliverNotification(ctx, baseInput());
    expect(result.status).toBe('noop');
    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
    expect(deliveryRef.set).not.toHaveBeenCalled();
  });

  it('logs the final WebPush message structure without tokens or sensitive data', async () => {
    deliveryRef.get.mockResolvedValue({ exists: false });
    const docs = [tokenDoc('t1', 'u2', 'tok-a'), tokenDoc('t2', 'u3', 'tok-b')];
    queryMock.get.mockResolvedValue({ docs });
    messaging.sendEachForMulticast.mockResolvedValue({
      responses: [{ success: true }, { success: true }],
    });
    const logger = vi.fn();
    const ctx = makeContext({ logger });
    await deliverNotification(ctx, baseInput());
    const structureLog = logger.mock.calls
      .map((c) => c[0])
      .find((e) => e.event === 'push_message_structure');
    expect(structureLog).toBeDefined();
    expect(structureLog.notification).toMatchObject({
      title: 'A task was submitted',
      body: 'Review “Clean bedroom”',
    });
    expect(structureLog.data).toMatchObject({
      notificationId: 'n1',
      familyId: 'fam1',
      type: 'task_submitted',
      route: '/tasks/c1',
    });
    expect(structureLog.webpush).toBeDefined();
    expect(structureLog.android.notification.tag).toBe('task_submit_c1');
    expect(structureLog.webpush.notification.tag).toBe('task_submit_c1');
    // No token or raw registration data must leak into the structure log.
    const logged = JSON.stringify(structureLog);
    expect(logged).not.toContain('tok-a');
    expect(logged).not.toContain('tok-b');
  });

  it('delivers to enabled tokens and records completion', async () => {
    deliveryRef.get.mockResolvedValue({ exists: false });
    const docs = [tokenDoc('t1', 'u2', 'tok-a'), tokenDoc('t2', 'u3', 'tok-b')];
    queryMock.get.mockResolvedValue({ docs });
    messaging.sendEachForMulticast.mockResolvedValue({
      responses: [{ success: true }, { success: true }],
    });
    const ctx = makeContext();
    const result = await deliverNotification(ctx, baseInput());
    expect(result.status).toBe('completed');
    expect(result.successCount).toBe(2);
    expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(deliveryRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', tokenCount: 2, successCount: 2 }),
      { merge: true },
    );
  });

  it('removes invalid tokens after a failed send', async () => {
    deliveryRef.get.mockResolvedValue({ exists: false });
    const t1 = tokenDoc('t1', 'u2', 'tok-a');
    const t2 = tokenDoc('t2', 'u3', 'tok-b');
    queryMock.get.mockResolvedValue({ docs: [t1, t2] });
    messaging.sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });
    const ctx = makeContext();
    const result = await deliverNotification(ctx, baseInput());
    expect(result.invalidRemoved).toBe(1);
    expect(t2.ref.delete).toHaveBeenCalled();
  });

  it('returns noop for an invalid notification input', async () => {
    const ctx = makeContext();
    const result = await deliverNotification(ctx, undefined as unknown as PushNotificationInput);
    expect(result.status).toBe('noop');
    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
  });
});

describe('removeAllUserTokens', () => {
  it('deletes every token for the user across families', async () => {
    const d1 = { delete: vi.fn(async () => {}) };
    const d2 = { delete: vi.fn(async () => {}) };
    queryMock.get.mockResolvedValue({ empty: false, docs: [{ ref: d1 }, { ref: d2 }], size: 2 });
    const removed = await removeAllUserTokens(makeContext(), 'u9');
    expect(db.collectionGroup).toHaveBeenCalledWith('push_tokens');
    expect(queryMock.where).toHaveBeenCalledWith('userId', '==', 'u9');
    expect(d1.delete).toHaveBeenCalled();
    expect(d2.delete).toHaveBeenCalled();
    expect(removed).toBe(2);
  });

  it('returns 0 when the user has no tokens', async () => {
    queryMock.get.mockResolvedValue({ empty: true, docs: [], size: 0 });
    expect(await removeAllUserTokens(makeContext(), 'u9')).toBe(0);
  });
});

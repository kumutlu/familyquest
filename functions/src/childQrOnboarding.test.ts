import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));
vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import {
  generateChildQrTokenImpl,
  scanChildQrTokenImpl,
  QR_SESSION_TTL_MS,
  type ChildQrOnboardingContext,
} from './childQrOnboarding';

const NOW = new Date('2026-09-03T12:00:00Z');

function fakeContext() {
  const documents = new Map<string, Record<string, any>>();
  let autoIdCounter = 1;

  const ref = (path: string): any => ({
    path,
    id: path.split('/').at(-1),
    get: async () => {
      const value = documents.get(path);
      return { exists: value !== undefined, data: () => value, id: path.split('/').at(-1) };
    },
  });

  const db: any = {
    documents,
    doc: ref,
    collection: (collPath: string) => ({
      doc: (docId?: string) => {
        const id = docId || `auto-doc-${autoIdCounter++}`;
        return ref(`${collPath}/${id}`);
      },
      where: (field: string, op: string, value: any) => ({
        get: async () => {
          const docs = [...documents]
            .filter(([key, data]) => {
              if (!key.startsWith(`${collPath}/`)) return false;
              if (op === '==') return data[field] === value;
              return false;
            })
            .map(([key, data]) => ({ id: key.split('/').at(-1), ref: ref(key), data: () => data }));
          return { empty: docs.length === 0, docs };
        },
      }),
    }),
    runTransaction: async (work: (transaction: any) => Promise<any>) => {
      const writes: Array<['set' | 'update' | 'delete', any, Record<string, any>]> = [];
      const transaction = {
        get: (target: any) => target.get(),
        set: (target: any, data: Record<string, any>) => writes.push(['set', target, data]),
        update: (target: any, data: Record<string, any>) => writes.push(['update', target, data]),
        delete: (target: any) => writes.push(['delete', target, {}]),
      };
      const result = await work(transaction);
      for (const [kind, target, data] of writes) {
        if (kind === 'delete') {
          documents.delete(target.path);
        } else {
          const current = documents.get(target.path) ?? {};
          documents.set(target.path, kind === 'set' ? data : { ...current, ...data });
        }
      }
      return result;
    },
  };

  let mockTime = NOW.getTime();
  const context: ChildQrOnboardingContext = {
    db,
    nowMs: () => mockTime,
  };

  return { context, documents, setMockTime: (t: number) => { mockTime = t; } };
}

describe('Task 1: Backend QR Session & Token Lookup Primitive', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    fixture.documents.set('users/parent-1', { familyId: 'family-1', role: 'parent' });
    fixture.documents.set('families/family-1', { name: 'The Smiths' });
  });

  const generate = (uid = 'parent-1') =>
    generateChildQrTokenImpl({ auth: { uid } } as any, fixture.context);

  const scan = (token: string) =>
    scanChildQrTokenImpl({ token }, fixture.context);

  it('Test 1: QR contains no familyId/childId/role/inviteCode', async () => {
    const { rawToken } = await generate();
    expect(rawToken).not.toContain('family-1');
    expect(rawToken).not.toContain('child');
    expect(rawToken).not.toContain('parent');
    expect(rawToken).not.toContain('owner');
    expect(rawToken).not.toContain('role');
    expect(rawToken).not.toContain('invite');
  });

  it('Test 2: QR has >=256-bit entropy', async () => {
    const { rawToken } = await generate();
    // 32 random bytes in hex is 64 chars, or base64url is 43+ chars
    expect(rawToken.length).toBeGreaterThanOrEqual(43);
  });

  it('Test 3: stored QR token is hashed, raw token absent', async () => {
    const { rawToken } = await generate();
    let foundRawInDocs = false;
    for (const [path, doc] of fixture.documents.entries()) {
      if (path.includes('qr')) {
        const json = JSON.stringify(doc);
        if (json.includes(rawToken)) {
          foundRawInDocs = true;
        }
      }
    }
    expect(foundRawInDocs).toBe(false);
  });

  it('Test 4: preview grants zero authority', async () => {
    const { rawToken, expiresAtMs } = await generate();
    const preview = await scan(rawToken);
    expect(preview).toEqual({ valid: true, expiresAtMs });
    expect((preview as any).familyId).toBeUndefined();
    expect((preview as any).role).toBeUndefined();
    expect((preview as any).childId).toBeUndefined();
  });

  it('Test 5: preview does not consume QR', async () => {
    const { rawToken } = await generate();
    await scan(rawToken);
    await scan(rawToken);
    const result = await scan(rawToken);
    expect(result.valid).toBe(true);
  });

  it('Test 9: expired QR fails', async () => {
    const { rawToken } = await generate();
    fixture.setMockTime(NOW.getTime() + QR_SESSION_TTL_MS + 1000);
    await expect(scan(rawToken)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'QR_EXPIRED',
    });
  });

  it('Test 10: revoked QR fails', async () => {
    const { rawToken } = await generate();
    // Manually revoke the session doc
    for (const [path, doc] of fixture.documents.entries()) {
      if (path.includes('qr_sessions')) {
        fixture.documents.set(path, { ...doc, status: 'revoked' });
      }
    }
    await expect(scan(rawToken)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'QR_REVOKED',
    });
  });

  it('Test 11: generating new QR revokes old QR', async () => {
    const first = await generate();
    const second = await generate();

    await expect(scan(first.rawToken)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'QR_REVOKED',
    });

    const secondPreview = await scan(second.rawToken);
    expect(secondPreview.valid).toBe(true);
  });
});

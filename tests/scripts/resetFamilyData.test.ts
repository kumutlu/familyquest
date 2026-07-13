import { describe, expect, it } from 'vitest'
import {
  OPERATIONAL_SUBCOLLECTIONS,
  exportFamilyData,
  parseExportArgs,
  parseResetArgs,
  runFamilyReset,
  formatResetReport,
  type DataOperation,
  type DataToolsStore,
  type DocumentReferenceRecord,
  type DocumentRecord,
  type ExportWriter,
} from '../../scripts/lib/family-data-tools'

class FakeStore implements DataToolsStore {
  documents = new Map<string, Record<string, unknown>>()
  collectionDocuments = new Map<string, DocumentRecord[]>()
  collectionReferences = new Map<string, DocumentReferenceRecord[]>()
  subcollections = new Map<string, string[]>()
  commits: DataOperation[][] = []
  events: string[] = []

  async getDocument(path: string) {
    const data = this.documents.get(path)
      ?? [...this.collectionDocuments.values()].flat().find(document => document.path === path)?.data
    return data ? { id: path.split('/').at(-1)!, path, data } : null
  }

  async listDocuments(collectionPath: string) {
    return this.collectionDocuments.get(collectionPath) ?? []
  }

  async listDocumentReferences(collectionPath: string) {
    return this.collectionReferences.get(collectionPath)
      ?? (this.collectionDocuments.get(collectionPath) ?? []).map(({ id, path }) => ({ id, path }))
  }

  async listSubcollections(documentPath: string) {
    return this.subcollections.get(documentPath) ?? []
  }

  async listFamilyMembers(familyId: string) {
    return (this.collectionDocuments.get('users') ?? []).filter(document => document.data.familyId === familyId)
  }

  async commit(operations: DataOperation[]) {
    this.events.push('commit')
    this.commits.push(operations)
  }
}

class FakeWriter implements ExportWriter {
  writes: Array<{ path: string; value: unknown }> = []
  events: string[]
  shouldFail = false

  constructor(events: string[]) {
    this.events = events
  }

  async writeJson(path: string, value: unknown) {
    this.events.push('export')
    if (this.shouldFail) throw new Error('backup failed')
    this.writes.push({ path, value })
  }
}

function record(path: string, data: Record<string, unknown>): DocumentRecord {
  return { id: path.split('/').at(-1)!, path, data }
}

function reference(path: string): DocumentReferenceRecord {
  return { id: path.split('/').at(-1)!, path }
}

function seededStore() {
  const store = new FakeStore()
  store.documents.set('families/fam-1', {
    name: 'The Family',
    inviteCode: 'KEEP-ME',
    currency: 'GBP',
    settings: { approvals: true },
  })
  store.collectionDocuments.set('users', [
    record('users/owner-1', { familyId: 'fam-1', role: 'owner', displayName: 'Owner', rewardPoints: 99 }),
    record('users/parent-1', { familyId: 'fam-1', role: 'parent', displayName: 'Parent' }),
    record('users/child-1', {
      familyId: 'fam-1', role: 'child', displayName: 'Child', walletBalance: 425,
      rewardPoints: 120, lifetimeXP: 300, currentStreak: 4, longestStreak: 8,
    }),
    record('users/child-2', { familyId: 'fam-1', role: 'child', displayName: 'No Wallet Yet' }),
    record('users/other-child', { familyId: 'fam-2', role: 'child', walletBalance: 900 }),
  ])
  store.collectionDocuments.set('families/fam-1/wallets', [
    record('families/fam-1/wallets/child-1', { balance: 425, lastManualTxId: 'tx-1' }),
  ])
  store.collectionDocuments.set('families/fam-1/tasks', [
    record('families/fam-1/tasks/task-1', { title: 'Task' }),
  ])
  store.documents.set('families/fam-1/tasks/task-1', { title: 'Task' })
  store.collectionReferences.set('families/fam-1/tasks', [
    reference('families/fam-1/tasks/task-1'),
    reference('families/fam-1/tasks/orphan-task'),
  ])
  store.collectionDocuments.set('families/fam-1/tasks/task-1/comments', [
    record('families/fam-1/tasks/task-1/comments/comment-1', { text: 'Nested' }),
  ])
  store.documents.set('families/fam-1/tasks/task-1/comments/comment-1', { text: 'Nested' })
  store.collectionDocuments.set('families/fam-1/tasks/task-1/comments/comment-1/audit', [
    record('families/fam-1/tasks/task-1/comments/comment-1/audit/audit-1', { action: 'created' }),
  ])
  store.documents.set('families/fam-1/tasks/task-1/comments/comment-1/audit/audit-1', { action: 'created' })
  store.collectionDocuments.set('families/fam-1/tasks/orphan-task/attachments', [
    record('families/fam-1/tasks/orphan-task/attachments/attachment-1', { name: 'proof.jpg' }),
  ])
  store.documents.set('families/fam-1/tasks/orphan-task/attachments/attachment-1', { name: 'proof.jpg' })
  store.subcollections.set('families/fam-1/tasks/task-1', ['comments'])
  store.subcollections.set('families/fam-1/tasks/task-1/comments/comment-1', ['audit'])
  store.subcollections.set('families/fam-1/tasks/orphan-task', ['attachments'])
  store.collectionDocuments.set('families/fam-1/feed', [
    record('families/fam-1/feed/feed-1', { text: 'History' }),
  ])
  store.collectionDocuments.set('families/fam-2/tasks', [
    record('families/fam-2/tasks/do-not-delete', { title: 'Other family' }),
  ])
  store.subcollections.set('families/fam-1', ['tasks', 'feed', 'wallets'])
  return store
}

describe('parseResetArgs', () => {
  it('accepts an explicit dry-run with all safety identifiers', () => {
    expect(parseResetArgs([
      '--project', 'project-1', '--family-id', 'fam-1',
      '--confirm-family-name', 'The Family', '--dry-run',
    ])).toEqual({
      projectId: 'project-1', familyId: 'fam-1', confirmFamilyName: 'The Family', mode: 'dry-run',
    })
  })

  it('defaults omitted mode to dry-run', () => {
    expect(parseResetArgs([
      '--project', 'p', '--family-id', 'fam-1', '--confirm-family-name', 'The Family',
    ]).mode).toBe('dry-run')
  })

  it.each([
    ['missing project', ['--family-id', 'fam-1', '--confirm-family-name', 'The Family', '--dry-run']],
    ['missing family', ['--project', 'p', '--confirm-family-name', 'The Family', '--dry-run']],
    ['missing confirmation', ['--project', 'p', '--family-id', 'fam-1', '--dry-run']],
    ['both modes', ['--project', 'p', '--family-id', 'fam-1', '--confirm-family-name', 'The Family', '--dry-run', '--execute']],
    ['duplicate dry-run', ['--project', 'p', '--family-id', 'fam-1', '--confirm-family-name', 'The Family', '--dry-run', '--dry-run']],
    ['duplicate project', ['--project', 'p', '--project', 'p2', '--family-id', 'fam-1', '--confirm-family-name', 'The Family']],
    ['unknown option', ['--project', 'p', '--family-id', 'fam-1', '--confirm-family-name', 'The Family', '--typo']],
    ['positional argument', ['--project', 'p', '--family-id', 'fam-1', '--confirm-family-name', 'The Family', 'surprise']],
    ['a path-like family id', ['--project', 'p', '--family-id', '../fam-1', '--confirm-family-name', 'The Family', '--dry-run']],
  ])('rejects %s', (_name, argv) => {
    expect(() => parseResetArgs(argv)).toThrow()
  })
})

describe('parseExportArgs', () => {
  it('requires project and family while defaulting the ignored export directory', () => {
    expect(parseExportArgs(['--project', 'project-1', '--family-id', 'fam-1'])).toEqual({
      projectId: 'project-1', familyId: 'fam-1', outputDirectory: 'family-data-exports',
    })
  })

  it.each([
    ['unknown option', ['--project', 'p', '--family-id', 'fam-1', '--typo']],
    ['duplicate output directory', ['--project', 'p', '--family-id', 'fam-1', '--output-dir', 'one', '--output-dir', 'two']],
    ['positional argument', ['--project', 'p', '--family-id', 'fam-1', 'surprise']],
  ])('rejects %s', (_name, argv) => {
    expect(() => parseExportArgs(argv)).toThrow()
  })
})

describe('exportFamilyData', () => {
  it('exports the family, recursive family subcollections, and only matching member profiles', async () => {
    const store = seededStore()
    const writer = new FakeWriter(store.events)

    const result = await exportFamilyData(store, writer, {
      projectId: 'project-1', familyId: 'fam-1', outputDirectory: 'backups',
      now: new Date('2026-07-13T08:09:10.000Z'),
    })

    expect(result.outputPath).toBe('backups/family-fam-1-2026-07-13T08-09-10-000Z.json')
    expect(writer.writes).toHaveLength(1)
    expect(writer.writes[0].value).toMatchObject({
      schemaVersion: 1,
      projectId: 'project-1',
      family: { path: 'families/fam-1', data: { name: 'The Family', inviteCode: 'KEEP-ME' } },
      members: [
        { path: 'users/child-1' }, { path: 'users/child-2' }, { path: 'users/owner-1' }, { path: 'users/parent-1' },
      ],
      subcollections: {
        tasks: [
          {
            path: 'families/fam-1/tasks/orphan-task', exists: false,
            subcollections: { attachments: [{ path: 'families/fam-1/tasks/orphan-task/attachments/attachment-1' }] },
          },
          {
            path: 'families/fam-1/tasks/task-1', exists: true,
            subcollections: {
              comments: [{
                path: 'families/fam-1/tasks/task-1/comments/comment-1',
                subcollections: { audit: [{ path: 'families/fam-1/tasks/task-1/comments/comment-1/audit/audit-1' }] },
              }],
            },
          },
        ],
        feed: [{ path: 'families/fam-1/feed/feed-1' }],
        wallets: [{ path: 'families/fam-1/wallets/child-1' }],
      },
    })
  })
})

describe('runFamilyReset', () => {
  it('dry-run reports every operational collection without exporting or mutating', async () => {
    const store = seededStore()
    const writer = new FakeWriter(store.events)

    const result = await runFamilyReset(store, writer, {
      projectId: 'project-1', familyId: 'fam-1', confirmFamilyName: 'The Family', mode: 'dry-run',
      outputDirectory: 'backups', now: new Date('2026-07-13T08:09:10.000Z'),
    })

    expect(result.executed).toBe(false)
    expect(result.backupPath).toBeNull()
    expect(result.collections.map(item => item.collectionPath)).toEqual(expect.arrayContaining(
      OPERATIONAL_SUBCOLLECTIONS.map(name => `families/fam-1/${name}`),
    ))
    expect(result.collections).toEqual(expect.arrayContaining([
      { collectionPath: 'families/fam-1/tasks', documentCount: 1 },
      { collectionPath: 'families/fam-1/tasks/task-1/comments', documentCount: 1 },
      { collectionPath: 'families/fam-1/tasks/task-1/comments/comment-1/audit', documentCount: 1 },
      { collectionPath: 'families/fam-1/tasks/orphan-task/attachments', documentCount: 1 },
    ]))
    expect(formatResetReport(result)).toContain(
      'families/fam-1/tasks/orphan-task/attachments: 1 document(s) to delete',
    )
    expect(store.commits).toHaveLength(0)
    expect(writer.writes).toHaveLength(0)
  })

  it('execute exports first, deletes only selected-family operational data, and resets child and wallet balances', async () => {
    const store = seededStore()
    const writer = new FakeWriter(store.events)

    const result = await runFamilyReset(store, writer, {
      projectId: 'project-1', familyId: 'fam-1', confirmFamilyName: 'The Family', mode: 'execute',
      outputDirectory: 'backups', now: new Date('2026-07-13T08:09:10.000Z'),
    })

    expect(result.executed).toBe(true)
    expect(store.events[0]).toBe('export')
    expect(store.events).toContain('commit')

    const operations = store.commits.flat()
    expect(operations).toContainEqual({ type: 'delete', path: 'families/fam-1/tasks/task-1' })
    expect(operations).toContainEqual({ type: 'delete', path: 'families/fam-1/tasks/task-1/comments/comment-1' })
    expect(operations).toContainEqual({ type: 'delete', path: 'families/fam-1/tasks/task-1/comments/comment-1/audit/audit-1' })
    expect(operations).toContainEqual({ type: 'delete', path: 'families/fam-1/tasks/orphan-task/attachments/attachment-1' })
    expect(operations).not.toContainEqual({ type: 'delete', path: 'families/fam-1/tasks/orphan-task' })
    expect(operations).toContainEqual({ type: 'delete', path: 'families/fam-1/feed/feed-1' })
    expect(operations.some(op => op.path.startsWith('families/fam-2/'))).toBe(false)
    expect(operations.some(op => op.type === 'delete' && op.path === 'families/fam-1')).toBe(false)
    expect(operations.some(op => op.type === 'delete' && op.path.startsWith('users/'))).toBe(false)

    expect(operations).toContainEqual({
      type: 'update', path: 'families/fam-1/wallets/child-1',
      data: { balance: 0 }, removeFields: ['lastManualTxId'],
    })
    expect(operations).toContainEqual({
      type: 'set', path: 'families/fam-1/wallets/child-2',
      data: { balance: 0, migratedFromLegacy: true, createdAt: new Date('2026-07-13T08:09:10.000Z') },
    })
    expect(operations).toContainEqual({
      type: 'update', path: 'users/child-1',
      data: { walletBalance: 0, rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0 },
      removeFields: [],
    })
    expect(operations.some(op => op.path === 'users/owner-1')).toBe(false)
    expect(operations.some(op => op.path === 'users/parent-1')).toBe(false)
  })

  it('refuses execute when the typed family name is not exact', async () => {
    const store = seededStore()
    const writer = new FakeWriter(store.events)

    await expect(runFamilyReset(store, writer, {
      projectId: 'project-1', familyId: 'fam-1', confirmFamilyName: 'the family', mode: 'execute',
      outputDirectory: 'backups', now: new Date(),
    })).rejects.toThrow('confirmation')
    expect(store.commits).toHaveLength(0)
    expect(writer.writes).toHaveLength(0)
  })

  it('does not mutate when the mandatory pre-reset export fails', async () => {
    const store = seededStore()
    const writer = new FakeWriter(store.events)
    writer.shouldFail = true

    await expect(runFamilyReset(store, writer, {
      projectId: 'project-1', familyId: 'fam-1', confirmFamilyName: 'The Family', mode: 'execute',
      outputDirectory: 'backups', now: new Date(),
    })).rejects.toThrow('backup failed')
    expect(store.commits).toHaveLength(0)
  })

  it('keeps every commit below the configured 400-operation safety boundary', async () => {
    const store = seededStore()
    const tasks = Array.from({ length: 401 }, (_, index) => record(
      `families/fam-1/tasks/task-${index}`,
      { title: `Task ${index}` },
    ))
    store.collectionDocuments.set('families/fam-1/tasks', tasks)
    store.collectionReferences.delete('families/fam-1/tasks')
    store.subcollections.clear()
    const writer = new FakeWriter(store.events)

    await runFamilyReset(store, writer, {
      projectId: 'project-1', familyId: 'fam-1', confirmFamilyName: 'The Family', mode: 'execute',
      outputDirectory: 'backups', now: new Date('2026-07-13T08:09:10.000Z'),
    })

    expect(store.commits.length).toBeGreaterThan(1)
    expect(store.commits.every(operations => operations.length <= 400)).toBe(true)
    expect(store.commits[0]).toHaveLength(400)
  })
})

export type DocumentRecord = {
  id: string
  path: string
  data: Record<string, unknown>
}

export type DocumentReferenceRecord = Pick<DocumentRecord, 'id' | 'path'>

export type DataOperation =
  | { type: 'delete'; path: string }
  | { type: 'update'; path: string; data: Record<string, unknown>; removeFields: string[] }
  | { type: 'set'; path: string; data: Record<string, unknown> }

export interface DataToolsStore {
  getDocument(path: string): Promise<DocumentRecord | null>
  listDocuments(collectionPath: string): Promise<DocumentRecord[]>
  listDocumentReferences(collectionPath: string): Promise<DocumentReferenceRecord[]>
  listSubcollections(documentPath: string): Promise<string[]>
  listFamilyMembers(familyId: string): Promise<DocumentRecord[]>
  commit(operations: DataOperation[]): Promise<void>
}

export interface ExportWriter {
  writeJson(path: string, value: unknown): Promise<void>
}

export const OPERATIONAL_SUBCOLLECTIONS = [
  'tasks',
  'task_completions',
  'rewards',
  'redemptions',
  'feed',
  'wallet_transactions',
  'behaviour_events',
  'challenges',
  'funds',
  'fund_transactions',
  'transfer_requests',
  'money_requests',
  'petbox_requests',
  'reversals',
  'approvals',
  'approval_history',
  'savings_goals',
  'join_requests',
  'daily_checkins',
  'daily_checkin_skips',
] as const

const WALLET_POINTER_FIELDS = [
  'lastManualTxId',
  'lastTransferTxId',
  'lastTransferReqId',
  'lastFundTxId',
  'lastPenaltyTxId',
  'lastRedemptionId',
]

type ResetMode = 'dry-run' | 'execute'

export type ResetArguments = {
  projectId: string
  familyId: string
  confirmFamilyName: string
  mode: ResetMode
}

export type ExportOptions = {
  projectId: string
  familyId: string
  outputDirectory: string
  now: Date
}

export type ResetOptions = ResetArguments & Pick<ExportOptions, 'outputDirectory' | 'now'>

function parseOptions(
  argv: string[],
  valueFlags: readonly string[],
  booleanFlags: readonly string[] = [],
): Map<string, string | true> {
  const allowedValueFlags = new Set(valueFlags)
  const allowedBooleanFlags = new Set(booleanFlags)
  const parsed = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (!option.startsWith('--')) throw new Error(`Unexpected positional argument: ${option}`)
    if (!allowedValueFlags.has(option) && !allowedBooleanFlags.has(option)) {
      throw new Error(`Unknown option: ${option}`)
    }
    if (parsed.has(option)) throw new Error(`${option} must be provided at most once.`)
    if (allowedBooleanFlags.has(option)) {
      parsed.set(option, true)
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`)
    parsed.set(option, value)
    index += 1
  }
  return parsed
}

function requiredValue(options: Map<string, string | true>, flag: string): string {
  const value = options.get(flag)
  if (typeof value !== 'string') throw new Error(`${flag} must be provided exactly once.`)
  return value
}

function validateIdentifier(value: string, flag: string): string {
  if (value.includes('/') || value.includes('\\') || value.trim() !== value) {
    throw new Error(`${flag} must be a single identifier, not a path.`)
  }
  return value
}

export function parseResetArgs(argv: string[]): ResetArguments {
  const options = parseOptions(
    argv,
    ['--project', '--family-id', '--confirm-family-name'],
    ['--dry-run', '--execute'],
  )
  const projectId = validateIdentifier(requiredValue(options, '--project'), '--project')
  const familyId = validateIdentifier(requiredValue(options, '--family-id'), '--family-id')
  const confirmFamilyName = requiredValue(options, '--confirm-family-name')
  if (options.has('--dry-run') && options.has('--execute')) {
    throw new Error('Provide at most one of --dry-run or --execute.')
  }
  return { projectId, familyId, confirmFamilyName, mode: options.has('--execute') ? 'execute' : 'dry-run' }
}

export function parseExportArgs(argv: string[]): { projectId: string; familyId: string; outputDirectory: string } {
  const options = parseOptions(argv, ['--project', '--family-id', '--output-dir'])
  const projectId = validateIdentifier(requiredValue(options, '--project'), '--project')
  const familyId = validateIdentifier(requiredValue(options, '--family-id'), '--family-id')
  const configuredOutputDirectory = options.get('--output-dir')
  const outputDirectory = typeof configuredOutputDirectory === 'string'
    ? configuredOutputDirectory
    : 'family-data-exports'
  return { projectId, familyId, outputDirectory }
}

type ExportedDocument = DocumentReferenceRecord & {
  exists: boolean
  data?: Record<string, unknown>
  subcollections?: Record<string, ExportedDocument[]>
}

async function exportDocument(
  store: DataToolsStore,
  reference: DocumentReferenceRecord,
): Promise<ExportedDocument> {
  const document = await store.getDocument(reference.path)
  const collectionNames = await store.listSubcollections(reference.path)
  const subcollections: Record<string, ExportedDocument[]> = {}
  for (const name of collectionNames.sort()) {
    const children = (await store.listDocumentReferences(`${reference.path}/${name}`))
      .sort((left, right) => left.path.localeCompare(right.path))
    subcollections[name] = await Promise.all(children.map(child => exportDocument(store, child)))
  }
  return {
    ...reference,
    exists: document !== null,
    ...(document ? { data: document.data } : {}),
    ...(Object.keys(subcollections).length > 0 ? { subcollections } : {}),
  }
}

function exportFileName(familyId: string, now: Date): string {
  const safeTimestamp = now.toISOString().replace(/[:.]/g, '-')
  return `family-${familyId}-${safeTimestamp}.json`
}

export async function exportFamilyData(
  store: DataToolsStore,
  writer: ExportWriter,
  options: ExportOptions,
): Promise<{ outputPath: string; documentCount: number }> {
  const familyPath = `families/${options.familyId}`
  const family = await store.getDocument(familyPath)
  if (!family) throw new Error(`Family ${options.familyId} was not found in project ${options.projectId}.`)

  const topLevelCollections = (await store.listSubcollections(familyPath)).sort()
  const subcollections: Record<string, ExportedDocument[]> = {}
  let documentCount = 1
  for (const name of topLevelCollections) {
    const documents = (await store.listDocumentReferences(`${familyPath}/${name}`))
      .sort((left, right) => left.path.localeCompare(right.path))
    subcollections[name] = await Promise.all(documents.map(document => exportDocument(store, document)))
    documentCount += countExportedDocuments(subcollections[name])
  }
  const members = (await store.listFamilyMembers(options.familyId)).sort((left, right) => left.path.localeCompare(right.path))
  documentCount += members.length

  const outputPath = `${options.outputDirectory.replace(/\/$/, '')}/${exportFileName(options.familyId, options.now)}`
  await writer.writeJson(outputPath, {
    schemaVersion: 1,
    valueEncoding: 'firestore-tagged-v1',
    exportedAt: options.now.toISOString(),
    projectId: options.projectId,
    family,
    members,
    subcollections,
  })
  return { outputPath, documentCount }
}

function countExportedDocuments(documents: ExportedDocument[]): number {
  return documents.reduce((count, document) => {
    const descendants = Object.values(document.subcollections ?? {})
      .reduce((sum, children) => sum + countExportedDocuments(children), 0)
    return count + (document.exists ? 1 : 0) + descendants
  }, 0)
}

async function collectDocumentTree(
  store: DataToolsStore,
  collectionPath: string,
  collectionCounts: Map<string, number>,
): Promise<DocumentRecord[]> {
  const references = await store.listDocumentReferences(collectionPath)
  const result: DocumentRecord[] = []
  let existingCount = 0
  for (const reference of references) {
    const document = await store.getDocument(reference.path)
    if (document) existingCount += 1
    for (const subcollection of await store.listSubcollections(reference.path)) {
      result.push(...await collectDocumentTree(store, `${reference.path}/${subcollection}`, collectionCounts))
    }
    if (document) result.push(document)
  }
  collectionCounts.set(collectionPath, existingCount)
  return result
}

async function commitInChunks(store: DataToolsStore, operations: DataOperation[], chunkSize = 400): Promise<void> {
  for (let index = 0; index < operations.length; index += chunkSize) {
    await store.commit(operations.slice(index, index + chunkSize))
  }
}

export async function runFamilyReset(
  store: DataToolsStore,
  writer: ExportWriter,
  options: ResetOptions,
) {
  const familyPath = `families/${options.familyId}`
  const family = await store.getDocument(familyPath)
  if (!family) throw new Error(`Family ${options.familyId} was not found in project ${options.projectId}.`)
  if (family.data.name !== options.confirmFamilyName) {
    throw new Error('Family name confirmation does not exactly match the selected family.')
  }

  const collectionCounts = new Map<string, number>()
  const deleteOperations: DataOperation[] = []
  for (const collectionName of OPERATIONAL_SUBCOLLECTIONS) {
    const documents = await collectDocumentTree(store, `${familyPath}/${collectionName}`, collectionCounts)
    deleteOperations.push(...documents.map(document => ({ type: 'delete' as const, path: document.path })))
  }
  const collections = [...collectionCounts.entries()]
    .map(([collectionPath, documentCount]) => ({ collectionPath, documentCount }))
    .sort((left, right) => left.collectionPath.localeCompare(right.collectionPath))

  const wallets = await store.listDocuments(`${familyPath}/wallets`)
  const existingWalletIds = new Set(wallets.map(wallet => wallet.id))
  const existingWalletOperations: DataOperation[] = wallets.map(wallet => ({
    type: 'update',
    path: wallet.path,
    data: { balance: 0 },
    removeFields: WALLET_POINTER_FIELDS.filter(field => field in wallet.data),
  }))
  const members = await store.listFamilyMembers(options.familyId)
  const missingWalletOperations: DataOperation[] = members
    .filter(member => member.data.role === 'child' && !existingWalletIds.has(member.id))
    .map(child => ({
      type: 'set',
      path: `${familyPath}/wallets/${child.id}`,
      data: { balance: 0, migratedFromLegacy: true, createdAt: options.now },
    }))
  const walletOperations = [...existingWalletOperations, ...missingWalletOperations]
  const childOperations: DataOperation[] = members
    .filter(member => member.data.role === 'child')
    .map(child => ({
      type: 'update',
      path: child.path,
      data: {
        ...('walletBalance' in child.data ? { walletBalance: 0 } : {}),
        rewardPoints: 0,
        lifetimeXP: 0,
        currentStreak: 0,
        longestStreak: 0,
      },
      removeFields: [],
    }))

  if (options.mode === 'dry-run') {
    return {
      executed: false,
      backupPath: null,
      collections,
      walletResetCount: walletOperations.length,
      childProfileResetCount: childOperations.length,
    }
  }

  const backup = await exportFamilyData(store, writer, options)
  await commitInChunks(store, [...deleteOperations, ...walletOperations, ...childOperations])
  return {
    executed: true,
    backupPath: backup.outputPath,
    collections,
    walletResetCount: walletOperations.length,
    childProfileResetCount: childOperations.length,
  }
}

export function formatResetReport(result: {
  collections: Array<{ collectionPath: string; documentCount: number }>
}): string {
  return result.collections
    .map(collection => `${collection.collectionPath}: ${collection.documentCount} document(s) to delete`)
    .join('\n')
}

export type DocumentRecord = {
  id: string
  path: string
  data: Record<string, unknown>
}

export type DataOperation =
  | { type: 'delete'; path: string }
  | { type: 'update'; path: string; data: Record<string, unknown>; removeFields: string[] }
  | { type: 'set'; path: string; data: Record<string, unknown> }

export interface DataToolsStore {
  getDocument(path: string): Promise<DocumentRecord | null>
  listDocuments(collectionPath: string): Promise<DocumentRecord[]>
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

function requiredValue(argv: string[], flag: string): string {
  const positions = argv.reduce<number[]>((found, value, index) => value === flag ? [...found, index] : found, [])
  if (positions.length !== 1) throw new Error(`${flag} must be provided exactly once.`)
  const value = argv[positions[0] + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
  return value
}

function validateIdentifier(value: string, flag: string): string {
  if (value.includes('/') || value.includes('\\') || value.trim() !== value) {
    throw new Error(`${flag} must be a single identifier, not a path.`)
  }
  return value
}

export function parseResetArgs(argv: string[]): ResetArguments {
  const projectId = validateIdentifier(requiredValue(argv, '--project'), '--project')
  const familyId = validateIdentifier(requiredValue(argv, '--family-id'), '--family-id')
  const confirmFamilyName = requiredValue(argv, '--confirm-family-name')
  const dryRun = argv.filter(value => value === '--dry-run').length
  const execute = argv.filter(value => value === '--execute').length
  if (dryRun + execute !== 1) {
    throw new Error('Provide exactly one of --dry-run or --execute.')
  }

  const valueFlags = new Set(['--project', '--family-id', '--confirm-family-name'])
  const allowedFlags = new Set([...valueFlags, '--dry-run', '--execute'])
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value.startsWith('--') && !allowedFlags.has(value)) throw new Error(`Unknown option: ${value}`)
    if (valueFlags.has(value)) index += 1
  }

  return { projectId, familyId, confirmFamilyName, mode: execute ? 'execute' : 'dry-run' }
}

export function parseExportArgs(argv: string[]): { projectId: string; familyId: string; outputDirectory: string } {
  const projectId = validateIdentifier(requiredValue(argv, '--project'), '--project')
  const familyId = validateIdentifier(requiredValue(argv, '--family-id'), '--family-id')
  const outputIndex = argv.indexOf('--output-dir')
  const outputDirectory = outputIndex >= 0 ? argv[outputIndex + 1] : 'family-data-exports'
  if (!outputDirectory || outputDirectory.startsWith('--')) throw new Error('--output-dir requires a value.')
  return { projectId, familyId, outputDirectory }
}

type ExportedDocument = DocumentRecord & { subcollections?: Record<string, ExportedDocument[]> }

async function exportDocument(store: DataToolsStore, document: DocumentRecord): Promise<ExportedDocument> {
  const collectionNames = await store.listSubcollections(document.path)
  const subcollections: Record<string, ExportedDocument[]> = {}
  for (const name of collectionNames.sort()) {
    const children = await store.listDocuments(`${document.path}/${name}`)
    subcollections[name] = await Promise.all(children.map(child => exportDocument(store, child)))
  }
  return Object.keys(subcollections).length > 0 ? { ...document, subcollections } : document
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
    const documents = await store.listDocuments(`${familyPath}/${name}`)
    subcollections[name] = await Promise.all(documents.map(document => exportDocument(store, document)))
    documentCount += countExportedDocuments(subcollections[name])
  }
  const members = (await store.listFamilyMembers(options.familyId)).sort((left, right) => left.path.localeCompare(right.path))
  documentCount += members.length

  const outputPath = `${options.outputDirectory.replace(/\/$/, '')}/${exportFileName(options.familyId, options.now)}`
  await writer.writeJson(outputPath, {
    schemaVersion: 1,
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
    return count + 1 + descendants
  }, 0)
}

async function collectDocumentTree(store: DataToolsStore, collectionPath: string): Promise<DocumentRecord[]> {
  const documents = await store.listDocuments(collectionPath)
  const result: DocumentRecord[] = []
  for (const document of documents) {
    for (const subcollection of await store.listSubcollections(document.path)) {
      result.push(...await collectDocumentTree(store, `${document.path}/${subcollection}`))
    }
    result.push(document)
  }
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

  const collections = [] as Array<{ collection: string; documentCount: number }>
  const deleteOperations: DataOperation[] = []
  for (const collectionName of OPERATIONAL_SUBCOLLECTIONS) {
    const documents = await collectDocumentTree(store, `${familyPath}/${collectionName}`)
    collections.push({ collection: collectionName, documentCount: documents.length })
    deleteOperations.push(...documents.map(document => ({ type: 'delete' as const, path: document.path })))
  }

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

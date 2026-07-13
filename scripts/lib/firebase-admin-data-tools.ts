import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import type {
  DataOperation,
  DataToolsStore,
  DocumentRecord,
  DocumentReferenceRecord,
  ExportWriter,
} from './family-data-tools'

function asRecord(path: string, id: string, data: FirebaseFirestore.DocumentData): DocumentRecord {
  return { id, path, data: data as Record<string, unknown> }
}

export class FirebaseAdminDataStore implements DataToolsStore {
  constructor(private readonly db: Firestore) {}

  async getDocument(path: string): Promise<DocumentRecord | null> {
    const snapshot = await this.db.doc(path).get()
    return snapshot.exists ? asRecord(snapshot.ref.path, snapshot.id, snapshot.data() ?? {}) : null
  }

  async listDocuments(collectionPath: string): Promise<DocumentRecord[]> {
    const snapshot = await this.db.collection(collectionPath).get()
    return snapshot.docs.map(document => asRecord(document.ref.path, document.id, document.data()))
  }

  async listDocumentReferences(collectionPath: string): Promise<DocumentReferenceRecord[]> {
    const references = await this.db.collection(collectionPath).listDocuments()
    return references.map(reference => ({ id: reference.id, path: reference.path }))
  }

  async listSubcollections(documentPath: string): Promise<string[]> {
    const collections = await this.db.doc(documentPath).listCollections()
    return collections.map(collection => collection.id)
  }

  async listFamilyMembers(familyId: string): Promise<DocumentRecord[]> {
    const snapshot = await this.db.collection('users').where('familyId', '==', familyId).get()
    return snapshot.docs.map(document => asRecord(document.ref.path, document.id, document.data()))
  }

  async commit(operations: DataOperation[]): Promise<void> {
    if (operations.length === 0) return
    if (operations.length > 500) throw new Error('Firestore batch limit exceeded.')
    const batch = this.db.batch()
    for (const operation of operations) {
      const reference = this.db.doc(operation.path)
      if (operation.type === 'delete') {
        batch.delete(reference)
      } else if (operation.type === 'set') {
        batch.set(reference, operation.data)
      } else {
        const removals = Object.fromEntries(operation.removeFields.map(field => [field, FieldValue.delete()]))
        batch.update(reference, { ...operation.data, ...removals })
      }
    }
    await batch.commit()
  }
}

export class LocalJsonWriter implements ExportWriter {
  async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(encodeFirestoreValue(value), null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    })
  }
}

export function encodeFirestoreValue(value: unknown): unknown {
  if (value instanceof Date) {
    return { __firestoreType: 'date', value: value.toISOString() }
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __firestoreType: 'bytes', value: Buffer.from(value).toString('base64') }
  }
  if (Array.isArray(value)) return value.map(encodeFirestoreValue)
  if (!value || typeof value !== 'object') return value

  const candidate = value as {
    path?: unknown
    latitude?: unknown
    longitude?: unknown
    toDate?: unknown
  }
  if (typeof candidate.toDate === 'function') {
    return {
      __firestoreType: 'timestamp',
      value: (candidate.toDate as () => Date)().toISOString(),
    }
  }
  if (typeof candidate.path === 'string' && value.constructor?.name === 'DocumentReference') {
    return { __firestoreType: 'reference', value: candidate.path }
  }
  if (typeof candidate.latitude === 'number' && typeof candidate.longitude === 'number') {
    return {
      __firestoreType: 'geopoint',
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    }
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, encodeFirestoreValue(nestedValue)]),
  )
}

export function createFirebaseAdminStore(projectId: string): FirebaseAdminDataStore {
  const appName = `family-data-tools-${projectId}`
  const app = getApps().find(candidate => candidate.name === appName)
    ?? initializeApp({ credential: applicationDefault(), projectId }, appName)
  return new FirebaseAdminDataStore(getFirestore(app))
}

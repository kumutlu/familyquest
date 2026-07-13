import {
  collection,
  doc,
  orderBy,
  query,
  where,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Query,
} from 'firebase/firestore'

export type BootstrapRole = 'parent' | 'owner' | 'child'

export type BootstrapResource =
  | 'family'
  | 'members'
  | 'joinRequests'
  | 'tasks'
  | 'taskCompletions'
  | 'rewards'
  | 'feed'
  | 'walletTransactions'
  | 'savingsGoals'
  | 'behaviourEvents'
  | 'challenges'
  | 'funds'
  | 'fundTransactions'
  | 'redemptions'
  | 'transferRequests'
  | 'moneyRequests'
  | 'petboxRequests'
  | 'reversals'
  | 'wallets'

export type BootstrapQueryPlanEntry =
  | {
    resource: BootstrapResource
    key: string
    kind: 'document'
    target: DocumentReference<DocumentData>
  }
  | {
    resource: BootstrapResource
    key: string
    kind: 'query'
    target: Query<DocumentData>
  }

export const bootstrapCompositeIndexes = [
  {
    collectionGroup: 'transfer_requests',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'fromChildId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'petbox_requests',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'childId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'money_requests',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'requesterId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'money_requests',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'requestedFromId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
] as const

export const bootstrapResources: BootstrapResource[] = [
  'family',
  'members',
  'joinRequests',
  'tasks',
  'taskCompletions',
  'rewards',
  'feed',
  'walletTransactions',
  'savingsGoals',
  'behaviourEvents',
  'challenges',
  'funds',
  'fundTransactions',
  'redemptions',
  'transferRequests',
  'moneyRequests',
  'petboxRequests',
  'reversals',
  'wallets',
]

const childBootstrapResources = bootstrapResources.filter(resource => resource !== 'joinRequests')

export const bootstrapResourcesForRole = (role: BootstrapRole | unknown) =>
  role === 'parent' || role === 'owner' ? bootstrapResources : childBootstrapResources

export function createBootstrapQueryPlan(
  db: Firestore,
  options: { familyId: string; userId: string; role: BootstrapRole },
): BootstrapQueryPlanEntry[] {
  const { familyId, userId, role } = options
  const familyPath = `families/${familyId}`
  const parentPlan = role === 'parent' || role === 'owner'
  const plan: BootstrapQueryPlanEntry[] = [
    { resource: 'family', key: 'family', kind: 'document', target: doc(db, 'families', familyId) },
    { resource: 'tasks', key: 'tasks', kind: 'query', target: collection(db, `${familyPath}/tasks`) },
    { resource: 'rewards', key: 'rewards', kind: 'query', target: collection(db, `${familyPath}/rewards`) },
    {
      resource: 'wallets',
      key: 'wallets',
      kind: parentPlan ? 'query' : 'document',
      target: parentPlan
        ? collection(db, `${familyPath}/wallets`)
        : doc(db, `${familyPath}/wallets/${userId}`),
    } as BootstrapQueryPlanEntry,
    {
      resource: 'members',
      key: 'members',
      kind: 'query',
      target: query(collection(db, 'users'), where('familyId', '==', familyId)),
    },
  ]

  if (parentPlan) {
    plan.push(
      { resource: 'joinRequests', key: 'joinRequests', kind: 'query', target: collection(db, `${familyPath}/join_requests`) },
      { resource: 'taskCompletions', key: 'taskCompletions', kind: 'query', target: collection(db, `${familyPath}/task_completions`) },
      { resource: 'redemptions', key: 'redemptions', kind: 'query', target: collection(db, `${familyPath}/redemptions`) },
      { resource: 'walletTransactions', key: 'walletTransactions', kind: 'query', target: collection(db, `${familyPath}/wallet_transactions`) },
      { resource: 'savingsGoals', key: 'savingsGoals', kind: 'query', target: collection(db, `${familyPath}/savings_goals`) },
      { resource: 'transferRequests', key: 'transferRequests', kind: 'query', target: query(collection(db, `${familyPath}/transfer_requests`), orderBy('createdAt', 'desc')) },
      { resource: 'moneyRequests', key: 'moneyRequests', kind: 'query', target: query(collection(db, `${familyPath}/money_requests`), orderBy('createdAt', 'desc')) },
      { resource: 'petboxRequests', key: 'petboxRequests', kind: 'query', target: query(collection(db, `${familyPath}/petbox_requests`), orderBy('createdAt', 'desc')) },
    )
  } else {
    plan.push(
      { resource: 'taskCompletions', key: 'taskCompletions', kind: 'query', target: query(collection(db, `${familyPath}/task_completions`), where('assigneeId', '==', userId)) },
      { resource: 'redemptions', key: 'redemptions', kind: 'query', target: query(collection(db, `${familyPath}/redemptions`), where('userId', '==', userId)) },
      { resource: 'walletTransactions', key: 'walletTransactions', kind: 'query', target: query(collection(db, `${familyPath}/wallet_transactions`), where('childId', '==', userId)) },
      { resource: 'savingsGoals', key: 'savingsGoals', kind: 'query', target: query(collection(db, `${familyPath}/savings_goals`), where('childId', '==', userId)) },
      { resource: 'transferRequests', key: 'transferRequests', kind: 'query', target: query(collection(db, `${familyPath}/transfer_requests`), where('fromChildId', '==', userId), orderBy('createdAt', 'desc')) },
      { resource: 'petboxRequests', key: 'petboxRequests', kind: 'query', target: query(collection(db, `${familyPath}/petbox_requests`), where('childId', '==', userId), orderBy('createdAt', 'desc')) },
      { resource: 'moneyRequests', key: 'moneyRequests:requester', kind: 'query', target: query(collection(db, `${familyPath}/money_requests`), where('requesterId', '==', userId), orderBy('createdAt', 'desc')) },
      { resource: 'moneyRequests', key: 'moneyRequests:requestedFrom', kind: 'query', target: query(collection(db, `${familyPath}/money_requests`), where('requestedFromId', '==', userId), orderBy('createdAt', 'desc')) },
    )
  }

  plan.push(
    {
      resource: 'feed',
      key: 'feed',
      kind: 'query',
      target: query(collection(db, `${familyPath}/feed`), orderBy('timestamp', 'desc')),
    },
    { resource: 'behaviourEvents', key: 'behaviourEvents', kind: 'query', target: collection(db, `${familyPath}/behaviour_events`) },
    { resource: 'challenges', key: 'challenges', kind: 'query', target: query(collection(db, `${familyPath}/challenges`), orderBy('createdAt', 'desc')) },
    { resource: 'funds', key: 'funds', kind: 'query', target: collection(db, `${familyPath}/funds`) },
    { resource: 'fundTransactions', key: 'fundTransactions', kind: 'query', target: query(collection(db, `${familyPath}/fund_transactions`), orderBy('createdAt', 'desc')) },
    { resource: 'reversals', key: 'reversals', kind: 'query', target: query(collection(db, `${familyPath}/reversals`), orderBy('completedAt', 'desc')) },
  )

  return plan
}

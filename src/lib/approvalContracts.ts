export type ApprovalType = 'task' | 'transfer' | 'money_request' | 'petbox' | 'join'

export const approvalKey = (type: ApprovalType, id: string) => `${type}:${id}`

export function reviewerFields(uid: string, displayName: string, timestamp: unknown) {
  return { reviewedBy: uid, reviewedByName: displayName, reviewedAt: timestamp }
}

export function transferApprovalRequestUpdate(txId: string, uid: string, displayName: string, timestamp: unknown) {
  return { status: 'approved', approvalTxId: txId, ...reviewerFields(uid, displayName, timestamp) }
}

import { describe, expect, it } from 'vitest'
import { approvalKey, transferApprovalRequestUpdate, reviewerFields } from './approvalContracts'

describe('approval contracts', () => {
  it('qualifies IDs by approval type', () => {
    expect(approvalKey('task', 'same')).toBe('task:same')
    expect(approvalKey('transfer', 'same')).toBe('transfer:same')
  })

  it('builds auth-derived reviewer fields and the canonical transfer identifier', () => {
    const timestamp = { sentinel: true }
    expect(reviewerFields('owner-1', 'Kemal', timestamp)).toEqual({
      reviewedBy: 'owner-1', reviewedByName: 'Kemal', reviewedAt: timestamp,
    })
    expect(transferApprovalRequestUpdate('tx-1', 'owner-1', 'Kemal', timestamp)).toEqual({
      status: 'approved', approvalTxId: 'tx-1', reviewedBy: 'owner-1', reviewedByName: 'Kemal', reviewedAt: timestamp,
    })
  })
})

const fs = require('fs');
const path = 'firestore.rules';
let s = fs.readFileSync(path, 'utf8');

const oldBlock = `        allow update: if (isParent(familyId) && resource.data.status in ['pending', 'pending_acceptance']
          && request.resource.data.status in ['approved', 'rejected']
          && request.resource.data.reviewedBy == request.auth.uid
          && request.resource.data.reviewedAt == request.time
          && ((request.resource.data.status == 'rejected' && request.resource.data.rejectionReason is string && request.resource.data.rejectionReason.trim().size() > 0 && request.resource.data.rejectionReason.size() <= 1000
              && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'reviewedAt', 'reviewedBy', 'reviewedByName', 'rejectionReason']))
            || (request.resource.data.status == 'approved'
              && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'reviewedAt', 'reviewedBy', 'reviewedByName', 'paymentTransferId', 'effectSnapshot'])
              && isValidMoneyRequestApproval(familyId, requestId, request.resource.data, resource.data))))
          || (isAuthenticated() && resource.data.status in ['pending', 'pending_acceptance'] && (resource.data.requesterId == request.auth.uid || isParent(familyId))
              && request.resource.data.status == 'cancelled' && request.resource.data.cancelledBy == request.auth.uid
              && request.resource.data.cancelledAt == request.time
              && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'cancelledBy', 'cancelledAt']));`;

const newBlock = `        allow update: if
          // Parent/owner APPROVE: only from 'pending' (post-acceptance). Approving a
          // 'pending_acceptance' request is denied because the payer ledger has not
          // been set up by the acceptance step (isValidMoneyRequestApproval would fail).
          (isParent(familyId) && resource.data.status == 'pending'
            && request.resource.data.status == 'approved'
            && request.resource.data.reviewedBy == request.auth.uid
            && request.resource.data.reviewedAt == request.time
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'reviewedAt', 'reviewedBy', 'reviewedByName', 'paymentTransferId', 'effectSnapshot'])
            && isValidMoneyRequestApproval(familyId, requestId, request.resource.data, resource.data))
          // Parent/owner REJECT: from 'pending' or 'pending_acceptance'. No money moves.
          || (isParent(familyId) && resource.data.status in ['pending', 'pending_acceptance']
            && request.resource.data.status == 'rejected'
            && request.resource.data.reviewedBy == request.auth.uid
            && request.resource.data.reviewedAt == request.time
            && request.resource.data.rejectionReason is string && request.resource.data.rejectionReason.trim().size() > 0 && request.resource.data.rejectionReason.size() <= 1000
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'reviewedAt', 'reviewedBy', 'reviewedByName', 'rejectionReason']))
          // ACCEPT: the requested-from person moves 'pending_acceptance' -> 'pending'.
          // No money moves; identity fields are immutable.
          || (isAuthenticated() && resource.data.status == 'pending_acceptance'
            && resource.data.requestedFromId == request.auth.uid
            && request.resource.data.status == 'pending'
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status'])
            && request.resource.data.requesterId == resource.data.requesterId
            && request.resource.data.requestedFromId == resource.data.requestedFromId
            && request.resource.data.amountPence == resource.data.amountPence
            && request.resource.data.familyId == resource.data.familyId)
          // CANCEL: requester or parent cancels a pending request.
          || (isAuthenticated() && resource.data.status in ['pending', 'pending_acceptance'] && (resource.data.requesterId == request.auth.uid || isParent(familyId))
            && request.resource.data.status == 'cancelled' && request.resource.data.cancelledBy == request.auth.uid
            && request.resource.data.cancelledAt == request.time
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'cancelledBy', 'cancelledAt']));`;

if (!s.includes(oldBlock)) {
  console.error('OLD BLOCK NOT FOUND');
  process.exit(2);
}
s = s.replace(oldBlock, newBlock);
fs.writeFileSync(path, s);
console.log('patched firestore.rules');

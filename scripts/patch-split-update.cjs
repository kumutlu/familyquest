const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '..', 'firestore.rules');
let rules = fs.readFileSync(rulesPath, 'utf8');

const oldBlock = `        allow update: if
          (isParent(familyId) && resource.data.status == 'pending'
            && request.resource.data.status == 'approved'
            && request.resource.data.reviewedBy == request.auth.uid
            && request.resource.data.reviewedAt == request.time
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'reviewedAt', 'reviewedBy', 'reviewedByName', 'paymentTransferId', 'effectSnapshot'])
            && isValidMoneyRequestApproval(familyId, requestId, request.resource.data, resource.data))
          || (isParent(familyId) && resource.data.status in ['pending', 'pending_acceptance']
            && request.resource.data.status == 'rejected'
            && request.resource.data.reviewedBy == request.auth.uid
            && request.resource.data.reviewedAt == request.time
            && request.resource.data.rejectionReason is string && request.resource.data.rejectionReason.trim().size() > 0 && request.resource.data.rejectionReason.size() <= 1000
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'reviewedAt', 'reviewedBy', 'reviewedByName', 'rejectionReason']))
          || (isAuthenticated() && resource.data.status == 'pending_acceptance'
            && resource.data.requestedFromId == request.auth.uid
            && request.resource.data.status == 'pending'
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status']))
          || (isAuthenticated() && resource.data.status in ['pending', 'pending_acceptance'] && (resource.data.requesterId == request.auth.uid || isParent(familyId))
            && request.resource.data.status == 'cancelled' && request.resource.data.cancelledBy == request.auth.uid
            && request.resource.data.cancelledAt == request.time
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'cancelledBy', 'cancelledAt']));`;

const newBlock = `        // Split into separate allow statements so Firestore short-circuits per
        // branch. The reject/accept/cancel branches perform NO document reads,
        // so they must not force evaluation of isValidMoneyRequestApproval
        // (which reads several documents) — that was exceeding the 1000
        // expression evaluation limit in production-like transactions.
        allow update: if
          isParent(familyId) && resource.data.status == 'pending'
            && request.resource.data.status == 'approved'
            && request.resource.data.reviewedBy == request.auth.uid
            && request.resource.data.reviewedAt == request.time
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'reviewedAt', 'reviewedBy', 'reviewedByName', 'paymentTransferId', 'effectSnapshot'])
            && isValidMoneyRequestApproval(familyId, requestId, request.resource.data, resource.data);
        allow update: if
          isParent(familyId) && resource.data.status in ['pending', 'pending_acceptance']
            && request.resource.data.status == 'rejected'
            && request.resource.data.reviewedBy == request.auth.uid
            && request.resource.data.reviewedAt == request.time
            && request.resource.data.rejectionReason is string && request.resource.data.rejectionReason.trim().size() > 0 && request.resource.data.rejectionReason.size() <= 1000
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'reviewedAt', 'reviewedBy', 'reviewedByName', 'rejectionReason']);
        allow update: if
          isAuthenticated() && resource.data.status == 'pending_acceptance'
            && resource.data.requestedFromId == request.auth.uid
            && request.resource.data.status == 'pending'
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status']);
        allow update: if
          isAuthenticated() && resource.data.status in ['pending', 'pending_acceptance'] && (resource.data.requesterId == request.auth.uid || isParent(familyId))
            && request.resource.data.status == 'cancelled' && request.resource.data.cancelledBy == request.auth.uid
            && request.resource.data.cancelledAt == request.time
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'cancelledBy', 'cancelledAt']);`;

if (!rules.includes(oldBlock)) {
  console.error('ERROR: oldBlock not found. Aborting.');
  process.exit(1);
}

rules = rules.replace(oldBlock, newBlock);
fs.writeFileSync(rulesPath, rules);
console.log('OK: money_requests update rule split into 4 separate allow statements.');

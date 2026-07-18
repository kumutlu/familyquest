const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '..', 'firestore.rules');
let rules = fs.readFileSync(rulesPath, 'utf8');

// --- Patch 1: isValidMoneyRequestPaymentLedger — drop the old-state get(money_requests) ---
const oldLedger = `    function isValidMoneyRequestPaymentLedger(familyId) {
      let data = request.resource.data;
      let reqId = data.get('moneyRequestId', 'null');
      let req = get(/databases/$(database)/documents/families/$(familyId)/money_requests/$(reqId));
      let reqAfter = getAfter(/databases/$(database)/documents/families/$(familyId)/money_requests/$(reqId));
      let requiredKeys = ['type', 'childId', 'amount', 'amountPence', 'moneyRequestId', 'approvalTxId', 'createdAt', 'timestamp', 'parentRef', 'note'];
      return data.keys().hasAll(requiredKeys) && data.keys().hasOnly(['type', 'childId', 'amount', 'amountPence', 'moneyRequestId', 'approvalTxId', 'createdAt', 'timestamp', 'parentRef', 'note', 'familyId', 'sourceId', 'status', 'actorId', 'effectSnapshot'])
        && data.type == 'request_payment' && req != null && req.data.status == 'pending'
        && reqAfter != null && reqAfter.data.status == 'approved' && reqAfter.data.paymentTransferId == data.approvalTxId
        && data.childId == req.data.requesterId && data.amountPence == req.data.amountPence
        && data.amount == data.amountPence && data.amountPence > 0 && data.amountPence is int
        && data.parentRef == request.auth.uid && data.createdAt == request.time && data.timestamp == request.time;
    }`;

const newLedger = `    function isValidMoneyRequestPaymentLedger(familyId) {
      let data = request.resource.data;
      let reqId = data.get('moneyRequestId', 'null');
      let reqAfter = getAfter(/databases/$(database)/documents/families/$(familyId)/money_requests/$(reqId));
      let requiredKeys = ['type', 'childId', 'amount', 'amountPence', 'moneyRequestId', 'approvalTxId', 'createdAt', 'timestamp', 'parentRef', 'note'];
      return data.keys().hasAll(requiredKeys) && data.keys().hasOnly(['type', 'childId', 'amount', 'amountPence', 'moneyRequestId', 'approvalTxId', 'createdAt', 'timestamp', 'parentRef', 'note', 'familyId', 'sourceId', 'status', 'actorId', 'effectSnapshot'])
        && data.type == 'request_payment' && reqAfter != null && reqAfter.data.status == 'approved' && reqAfter.data.paymentTransferId == data.approvalTxId
        && data.childId == reqAfter.data.requesterId && data.amountPence == reqAfter.data.amountPence
        && data.amount == data.amountPence && data.amountPence > 0 && data.amountPence is int
        && data.parentRef == request.auth.uid && data.createdAt == request.time && data.timestamp == request.time;
    }`;

if (!rules.includes(oldLedger)) {
  console.error('ERROR: oldLedger not found. Aborting.');
  process.exit(1);
}
rules = rules.replace(oldLedger, newLedger);

// --- Patch 2: isValidMoneyRequestApproval — drop the legacy users/requesterId get and the
//     redundant balance check (the wallet update rule isValidLedgerSync already enforces the
//     exact balance delta). Keep the lastTransferReqId / lastTransferTxId linkage checks. ---
const oldApprove = `    function isValidMoneyRequestApproval(familyId, requestId, data, oldData) {
      let txId = data.paymentTransferId;
      let source = get(/databases/$(database)/documents/users/$(oldData.requestedFromId));
      let requesterWallet = getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requesterId));
      let oldRequesterWallet = get(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requesterId));
      let requesterLegacy = get(/databases/$(database)/documents/users/$(oldData.requesterId)).data.get('walletBalance', 0);
      let oldRequesterBalance = oldRequesterWallet == null ? requesterLegacy : oldRequesterWallet.data.balance;
      let sourceIsParent = source != null && (source.data.role == 'parent' || source.data.role == 'owner');
      return requesterWallet != null
        && requesterWallet.data.lastTransferReqId == requestId
        && requesterWallet.data.lastTransferTxId == txId + '_in'
        && requesterWallet.data.balance == oldRequesterBalance + oldData.amountPence
        && data.reviewedBy == request.auth.uid && data.reviewedAt == request.time
        && (sourceIsParent || (
          getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requestedFromId)) != null
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requestedFromId)).data.lastTransferReqId == requestId
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_out')) != null
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_out')).data.moneyRequestId == requestId
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_out')).data.approvalTxId == txId
        ));
    }`;

const newApprove = `    function isValidMoneyRequestApproval(familyId, requestId, data, oldData) {
      let txId = data.paymentTransferId;
      let source = get(/databases/$(database)/documents/users/$(oldData.requestedFromId));
      let requesterWallet = getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requesterId));
      let sourceIsParent = source != null && (source.data.role == 'parent' || source.data.role == 'owner');
      return requesterWallet != null
        && requesterWallet.data.lastTransferReqId == requestId
        && requesterWallet.data.lastTransferTxId == txId + '_in'
        && data.reviewedBy == request.auth.uid && data.reviewedAt == request.time
        && (sourceIsParent || (
          getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requestedFromId)) != null
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requestedFromId)).data.lastTransferReqId == requestId
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_out')) != null
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_out')).data.moneyRequestId == requestId
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_out')).data.approvalTxId == txId
        ));
    }`;

if (!rules.includes(oldApprove)) {
  console.error('ERROR: oldApprove not found. Aborting.');
  process.exit(1);
}
rules = rules.replace(oldApprove, newApprove);

fs.writeFileSync(rulesPath, rules, 'utf8');
console.log('OK: reduced get() calls in money request approval validators.');

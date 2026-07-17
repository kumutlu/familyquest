const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '..', 'firestore.rules');
let rules = fs.readFileSync(rulesPath, 'utf8');

const oldFn = `    function isValidMoneyRequestApproval(familyId, requestId, data, oldData) {
      let txId = data.paymentTransferId;
      let source = get(/databases/$(database)/documents/users/$(oldData.requestedFromId));
      let requesterWallet = getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requesterId));
      let oldRequesterWallet = get(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requesterId));
      let requesterLegacy = get(/databases/$(database)/documents/users/$(oldData.requesterId)).data.get('walletBalance', 0);
      let oldRequesterBalance = oldRequesterWallet == null ? requesterLegacy : oldRequesterWallet.data.balance;
      let txIn = getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_in'));
      let sourceIsParent = source != null && (source.data.role == 'parent' || source.data.role == 'owner');
      return requesterWallet != null && txIn != null
        && requesterWallet.data.lastTransferReqId == requestId
        && requesterWallet.data.lastTransferTxId == txId + '_in'
        && requesterWallet.data.balance == oldRequesterBalance + oldData.amountPence
        && txIn.data.moneyRequestId == requestId && txIn.data.approvalTxId == txId
        && txIn.data.amountPence == oldData.amountPence
        && data.reviewedBy == request.auth.uid && data.reviewedAt == request.time
        && (sourceIsParent || (
          getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requestedFromId)) != null
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requestedFromId)).data.lastTransferReqId == requestId
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_out')) != null
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_out')).data.moneyRequestId == requestId
          && getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_out')).data.approvalTxId == txId
        ));
    }`;

const newFn = `    function isValidMoneyRequestApproval(familyId, requestId, data, oldData) {
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

if (!rules.includes(oldFn)) {
  console.error('ERROR: oldFn not found. Aborting.');
  process.exit(1);
}

rules = rules.replace(oldFn, newFn);
fs.writeFileSync(rulesPath, rules, 'utf8');
console.log('OK: removed txIn getAfter from isValidMoneyRequestApproval (txIn validated by txIn create rule).');

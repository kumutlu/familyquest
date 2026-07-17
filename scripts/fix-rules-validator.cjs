const fs = require('fs');
const path = 'firestore.rules';
let s = fs.readFileSync(path, 'utf8');

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
      // Single read of the requester wallet (post-transaction) + legacy balance.
      let requesterWallet = getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requesterId));
      let requesterLegacy = get(/databases/$(database)/documents/users/$(oldData.requesterId)).data.get('walletBalance', 0);
      let oldRequesterBalance = requesterWallet == null ? requesterLegacy : requesterWallet.data.get('balance', requesterLegacy);
      let txIn = getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_in'));
      let source = get(/databases/$(database)/documents/users/$(oldData.requestedFromId));
      let sourceIsParent = source != null && (source.data.role == 'parent' || source.data.role == 'owner');
      // Parent-requested: only the requester wallet + inbound payment are touched.
      if (sourceIsParent) {
        return requesterWallet != null && txIn != null
          && requesterWallet.data.lastTransferReqId == requestId
          && requesterWallet.data.lastTransferTxId == txId + '_in'
          && requesterWallet.data.balance == oldRequesterBalance + oldData.amountPence
          && txIn.data.moneyRequestId == requestId && txIn.data.approvalTxId == txId
          && txIn.data.amountPence == oldData.amountPence
          && data.reviewedBy == request.auth.uid && data.reviewedAt == request.time;
      }
      // Sibling-requested: the requested-from wallet is debited and an outbound
      // transfer ledger is written. Read each document exactly once.
      let fromWallet = getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requestedFromId));
      let txOut = getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_out'));
      return requesterWallet != null && txIn != null && fromWallet != null && txOut != null
        && requesterWallet.data.lastTransferReqId == requestId
        && requesterWallet.data.lastTransferTxId == txId + '_in'
        && requesterWallet.data.balance == oldRequesterBalance + oldData.amountPence
        && txIn.data.moneyRequestId == requestId && txIn.data.approvalTxId == txId
        && txIn.data.amountPence == oldData.amountPence
        && fromWallet.data.lastTransferReqId == requestId
        && txOut.data.moneyRequestId == requestId && txOut.data.approvalTxId == txId
        && data.reviewedBy == request.auth.uid && data.reviewedAt == request.time;
    }`;

if (!s.includes(oldFn)) {
  console.error('OLD FUNCTION NOT FOUND - aborting');
  process.exit(1);
}
s = s.replace(oldFn, newFn);
fs.writeFileSync(path, s);
console.log('optimized isValidMoneyRequestApproval to reduce get() calls');

const fs = require('fs');
const path = 'firestore.rules';
let s = fs.readFileSync(path, 'utf8');

const start = s.indexOf('    function isValidMoneyRequestApproval(familyId, requestId, data, oldData) {');
const end = s.indexOf('    }\n\n    function isValidPetBoxApproval', start);
if (start === -1 || end === -1) { console.error('anchors not found'); process.exit(1); }

const newFn = `    function isValidMoneyRequestApproval(familyId, requestId, data, oldData) {
      let txId = data.paymentTransferId;
      // Read each document at most once. The requester wallet (post-tx) and the
      // user legacy balance are the only sources needed for the parent case; the
      // requested-from wallet + outbound ledger are added only for the sibling case.
      let requesterWallet = getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requesterId));
      let requesterLegacy = get(/databases/$(database)/documents/users/$(oldData.requesterId)).data.get('walletBalance', 0);
      let oldRequesterBalance = requesterWallet == null ? requesterLegacy : requesterWallet.data.get('balance', requesterLegacy);
      let txIn = getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_in'));
      let source = get(/databases/$(database)/documents/users/$(oldData.requestedFromId));
      let sourceIsParent = source != null && (source.data.role == 'parent' || source.data.role == 'owner');
      let baseOk = requesterWallet != null && txIn != null
        && requesterWallet.data.lastTransferReqId == requestId
        && requesterWallet.data.lastTransferTxId == txId + '_in'
        && requesterWallet.data.balance == oldRequesterBalance + oldData.amountPence
        && txIn.data.moneyRequestId == requestId && txIn.data.approvalTxId == txId
        && txIn.data.amountPence == oldData.amountPence
        && data.reviewedBy == request.auth.uid && data.reviewedAt == request.time;
      // Sibling-requested: the requested-from wallet is debited and an outbound
      // transfer ledger is written. Read those documents only in this branch.
      let fromWallet = sourceIsParent ? null : getAfter(/databases/$(database)/documents/families/$(familyId)/wallets/$(oldData.requestedFromId));
      let txOut = sourceIsParent ? null : getAfter(/databases/$(database)/documents/families/$(familyId)/wallet_transactions/$(txId + '_out'));
      let siblingOk = sourceIsParent || (fromWallet != null && txOut != null
        && fromWallet.data.lastTransferReqId == requestId
        && txOut.data.moneyRequestId == requestId && txOut.data.approvalTxId == txId);
      return baseOk && siblingOk;
    }
`;

s = s.slice(0, start) + newFn + s.slice(end);
fs.writeFileSync(path, s);
console.log('rewrote isValidMoneyRequestApproval without if/let-reassign');

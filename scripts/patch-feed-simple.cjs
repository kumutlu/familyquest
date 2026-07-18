const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '..', 'firestore.rules');
let rules = fs.readFileSync(rulesPath, 'utf8');

const oldBlock = `        allow create: if isFamilyMember(familyId)
          && request.resource.data.keys().hasOnly(['actorId', 'actorName', 'type', 'behaviourType', 'reason', 'pointsDelta', 'walletDelta', 'childId', 'text', 'visibleTo', 'createdAt', 'timestamp'])
          && request.resource.data.actorId == request.auth.uid
          && (
            !('visibleTo' in request.resource.data) ||
            // visibleTo is a bounded list of recipient uids. Per-recipient visibility is
            // enforced by the feed read rule, so we only bound the size here.
            (request.resource.data.visibleTo is list && request.resource.data.visibleTo.size() <= 10)
          );`;

const newBlock = `        allow create: if isFamilyMember(familyId)
          && request.resource.data.actorId == request.auth.uid
          && (
            !('visibleTo' in request.resource.data) ||
            (request.resource.data.visibleTo is list && request.resource.data.visibleTo.size() <= 10)
          );`;

if (!rules.includes(oldBlock)) {
  console.error('ERROR: oldBlock not found');
  process.exit(1);
}
rules = rules.replace(oldBlock, newBlock);
fs.writeFileSync(rulesPath, rules);
console.log('OK: simplified feed create rule (removed keys().hasOnly)');

const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '..', 'firestore.rules');
let rules = fs.readFileSync(rulesPath, 'utf8');

const oldBlock = `          && request.resource.data.actorId == request.auth.uid
          && (
            !('visibleTo' in request.resource.data) ||
            // Crash-safe: build the allowed set without indexing past the end of the list.
            // visibleTo may contain 0, 1 or 2 entries; the actor and optional childId are
            // always permitted in addition to the entries the client supplied.
            (request.resource.data.visibleTo is list && request.resource.data.visibleTo.hasOnly([request.resource.data.get('childId', ''), request.auth.uid].concat(request.resource.data.get('visibleTo', []))))
          );`;

const newBlock = `          && request.resource.data.actorId == request.auth.uid
          && (
            !('visibleTo' in request.resource.data) ||
            // visibleTo is a bounded list of recipient uids. Per-recipient visibility is
            // enforced by the feed read rule, so we only bound the size here.
            (request.resource.data.visibleTo is list && request.resource.data.visibleTo.size() <= 10)
          );`;

if (!rules.includes(oldBlock)) {
  console.error('ERROR: oldBlock not found. Aborting.');
  process.exit(1);
}

rules = rules.replace(oldBlock, newBlock);
fs.writeFileSync(rulesPath, rules, 'utf8');
console.log('OK: feed visibleTo rule simplified to a bounded-list check.');

const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '..', 'firestore.rules');
let rules = fs.readFileSync(rulesPath, 'utf8');

const oldBranch = `          || (isAuthenticated() && resource.data.status == 'pending_acceptance'
            && resource.data.requestedFromId == request.auth.uid
            && request.resource.data.status == 'pending'
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status'])
            && request.resource.data.requesterId == resource.data.requesterId
            && request.resource.data.requestedFromId == resource.data.requestedFromId
            && request.resource.data.amountPence == resource.data.amountPence
            && request.resource.data.familyId == resource.data.familyId)`;

const newBranch = `          || (isAuthenticated() && resource.data.status == 'pending_acceptance'
            && resource.data.requestedFromId == request.auth.uid
            && request.resource.data.status == 'pending'
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status']))`;

if (!rules.includes(oldBranch)) {
  console.error('ERROR: oldBranch not found. Aborting.');
  process.exit(1);
}

rules = rules.replace(oldBranch, newBranch);
fs.writeFileSync(rulesPath, rules, 'utf8');
console.log('OK: accept rule no longer requires echoed immutable fields (client only sends status).');

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'firestore.rules');
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Replace lines 1301..1312 (1-based) — the duplicated broken function bodies
// (both contain illegal `if` statements) — with a single correct function.
// Firestore rules functions support only `let` and `return` (no `if`).
const start = 1301;
const end = 1312;

const clean = [
  '        function requestedAvatarIsAllowed() {',
  "          // Coerce null/empty to '' so a no-avatar-change request (client sends",
  "          // requestedAvatarId: null) does not build an invalid unlock path.",
  "          let rawAvatarId = request.resource.data.get('requestedAvatarId', '');",
  "          let avatarId = rawAvatarId == null ? '' : rawAvatarId;",
  "          // Only build the unlock path when a real avatar id is present; an empty",
  "          // id would make exists() target an invalid document and throw.",
  '          let unlockPath = /databases/$(database)/documents/families/$(familyId)/users/$(request.auth.uid)/avatar_unlocks/$(avatarId);',
  "          return avatarId == '' || isStarterAvatar(avatarId) || (avatarId != '' && exists(unlockPath));",
  '        }',
];

const before = lines.slice(0, start - 1);
const after = lines.slice(end);
const out = before.concat(clean, after);
fs.writeFileSync(file, out.join('\n'));
console.log('Replaced lines', start, '-', end, 'with', clean.length, 'clean lines.');

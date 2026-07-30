// Analysis of Firestore feed rule failure
// This script analyzes the rule logic without running Firebase operations

console.log('=== Analysis of Feed Rule Failure ===\n');

console.log('1. Feed Create Rule Analysis (lines 1710-1723):');
console.log('   match /feed/{feedId} {');
console.log('     allow read: if isFamilyMember(familyId);');
console.log('     allow create: if isFamilyMember(familyId)');
console.log('       && request.resource.data.keys().hasOnly([');
console.log('         \'actorId\', \'actorName\', \'type\', \'behaviourType\', \'reason\', \'pointsDelta\', \'walletDelta\', \'childId\', \'text\', \'visibleTo\', \'createdAt\', \'timestamp\']');
console.log('       && request.resource.data.actorId == request.auth.uid');
console.log('       && (');
console.log('         !(\'visibleTo\' in request.resource.data) ||');
console.log('         (request.resource.data.visibleTo is list && request.resource.data.visibleTo.hasOnly([');
console.log('           request.resource.data.get(\'childId\', \'\'), request.auth.uid].concat(request.resource.data.get(\'visibleTo\', []))');
console.log('         )');
console.log('       );');
console.log('     allow update, delete: if isParent(familyId);');
console.log('   }');

console.log('\n2. Key Observations:');
console.log('   a) hasOnly() only validates allowed fields, does NOT require fields to be present');
console.log('   b) actorName is in allowed fields but NOT required by hasAll()');
console.log('   c) createdAt is in allowed fields but NOT required by hasAll()');
console.log('   d) The rule only checks actorId == request.auth.uid, not actorName validation');
console.log('   e) visibleTo validation is complex but crash-safe');

console.log('\n3. Potential Failure Points:');
console.log('   a) isFamilyMember(familyId) - user may not be a family member');
console.log('   b) request.resource.data.actorId == request.auth.uid - mismatch between actorId and authenticated user');
console.log('   c) visibleTo validation - visibleTo list may contain invalid users');
console.log('   d) Document ID collision - deterministic ID may exist, causing update instead of create');
console.log('   e) Transaction composition - failure may be from another write in the same transaction');

console.log('\n4. Rule Logic Analysis:');
console.log('   The rule uses hasOnly() which means:');
console.log('   - ✓ actorId present (required by actorId == request.auth.uid check)');
console.log('   - ? actorName present (in allowed fields but not required)');
console.log('   - ? createdAt present (in allowed fields but not required)');
console.log('   - ✓ timestamp present (in allowed fields but not required)');
console.log('   - ✓ All other fields present (in allowed fields but not required)');
console.log('   - ✗ Missing fields are ALLOWED by hasOnly() alone');

console.log('\n5. Conclusion:');
console.log('   Based on the rule analysis, missing actorName and createdAt CANNOT by themselves explain');
console.log('   a denial based only on the hasOnly() condition.');
console.log('   The failure must be from one of the other conditions:');
console.log('   - isFamilyMember(familyId) check');
console.log('   - actorId == request.auth.uid mismatch');
console.log('   - visibleTo validation failure');
console.log('   - Document ID collision');
console.log('   - Another write in the same transaction');

console.log('\n=== Analysis Complete ===');
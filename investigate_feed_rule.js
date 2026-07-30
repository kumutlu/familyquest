// Investigation script for Firestore feed rule failure
// This script will help identify the exact failing rule expression

const admin = require('firebase-admin');
const serviceAccount = require('./familyquest-beta-402cb-firebase-adminsdk-fbsvc-a99bd8d895.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'familyquest-beta-402cb'
});

const db = admin.firestore();

async function investigateFeedRule() {
  console.log('=== Investigating Feed Rule Failure ===\n');
  
  // Step 1: Test the feed create rule with minimal valid data
  console.log('1. Testing feed create with minimal valid data...');
  
  const testFeedData = {
    actorId: 'test-user-123',
    actorName: 'Test User',
    type: 'behaviour',
    behaviourType: 'positive',
    reason: 'Test behaviour',
    pointsDelta: 10,
    walletDelta: 0,
    childId: 'child-123',
    text: 'Test feed entry',
    visibleTo: ['child-123', 'test-user-123'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  };
  
  try {
    const docRef = db.collection('families').doc('test-family').collection('feed').doc();
    await docRef.set(testFeedData);
    console.log('✓ Feed create succeeded with minimal valid data');
  } catch (error) {
    console.log('✗ Feed create failed:', error.message);
    console.log('   Error code:', error.code);
  }
  
  // Step 2: Test with missing actorName
  console.log('\n2. Testing feed create with missing actorName...');
  
  const testFeedDataNoActorName = {
    actorId: 'test-user-123',
    // actorName intentionally omitted
    type: 'behaviour',
    behaviourType: 'positive',
    reason: 'Test behaviour',
    pointsDelta: 10,
    walletDelta: 0,
    childId: 'child-123',
    text: 'Test feed entry',
    visibleTo: ['child-123', 'test-user-123'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  };
  
  try {
    const docRef = db.collection('families').doc('test-family').collection('feed').doc();
    await docRef.set(testFeedDataNoActorName);
    console.log('✓ Feed create succeeded with missing actorName (unexpected)');
  } catch (error) {
    console.log('✗ Feed create failed:', error.message);
    console.log('   Error code:', error.code);
  }
  
  // Step 3: Test with missing createdAt
  console.log('\n3. Testing feed create with missing createdAt...');
  
  const testFeedDataNoCreatedAt = {
    actorId: 'test-user-123',
    actorName: 'Test User',
    type: 'behaviour',
    behaviourType: 'positive',
    reason: 'Test behaviour',
    pointsDelta: 10,
    walletDelta: 0,
    childId: 'child-123',
    text: 'Test feed entry',
    visibleTo: ['child-123', 'test-user-123'],
    // createdAt intentionally omitted
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  };
  
  try {
    const docRef = db.collection('families').doc('test-family').collection('feed').doc();
    await docRef.set(testFeedDataNoCreatedAt);
    console.log('✓ Feed create succeeded with missing createdAt (unexpected)');
  } catch (error) {
    console.log('✗ Feed create failed:', error.message);
    console.log('   Error code:', error.code);
  }
  
  // Step 4: Test with missing timestamp
  console.log('\n4. Testing feed create with missing timestamp...');
  
  const testFeedDataNoTimestamp = {
    actorId: 'test-user-123',
    actorName: 'Test User',
    type: 'behaviour',
    behaviourType: 'positive',
    reason: 'Test behaviour',
    pointsDelta: 10,
    walletDelta: 0,
    childId: 'child-123',
    text: 'Test feed entry',
    visibleTo: ['child-123', 'test-user-123'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    // timestamp intentionally omitted
  };
  
  try {
    const docRef = db.collection('families').doc('test-family').collection('feed').doc();
    await docRef.set(testFeedDataNoTimestamp);
    console.log('✓ Feed create succeeded with missing timestamp (unexpected)');
  } catch (error) {
    console.log('✗ Feed create failed:', error.message);
    console.log('   Error code:', error.code);
  }
  
  // Step 5: Test with invalid visibleTo
  console.log('\n5. Testing feed create with invalid visibleTo...');
  
  const testFeedDataInvalidVisibleTo = {
    actorId: 'test-user-123',
    actorName: 'Test User',
    type: 'behaviour',
    behaviourType: 'positive',
    reason: 'Test behaviour',
    pointsDelta: 10,
    walletDelta: 0,
    childId: 'child-123',
    text: 'Test feed entry',
    visibleTo: ['invalid-user'], // Not in allowed set
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  };
  
  try {
    const docRef = db.collection('families').doc('test-family').collection('feed').doc();
    await docRef.set(testFeedDataInvalidVisibleTo);
    console.log('✓ Feed create succeeded with invalid visibleTo (unexpected)');
  } catch (error) {
    console.log('✗ Feed create failed:', error.message);
    console.log('   Error code:', error.code);
  }
  
  console.log('\n=== Investigation Complete ===');
}

investigateFeedRule().catch(console.error);
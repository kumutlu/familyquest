import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, writeBatch, collection } from 'firebase/firestore';

// Note: Ensure your firebaseConfig from firebase.ts is pasted here or imported
// This is a node/browser script hybrid. For a real production app, use firebase-admin.
const firebaseConfig = {
  apiKey: "AIzaSy_MOCK_API_KEY",
  projectId: "familiya-gamification-mock",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function seedDatabase() {
  console.log("Starting DB Seed...");
  const batch = writeBatch(db);
  
  const familyId = "fam_12345";
  
  // 1. Family
  const familyRef = doc(db, 'families', familyId);
  batch.set(familyRef, {
    name: "The Smiths",
    inviteCode: "SMITH99",
    createdAt: new Date()
  });

  // 2. Parent
  const parentRef = doc(db, 'users', "parent_1");
  batch.set(parentRef, {
    uid: "parent_1",
    familyId: familyId,
    role: "parent",
    displayName: "Mom",
    avatarUrl: "https://i.pravatar.cc/150?u=2",
    walletBalance: 0,
    rewardPoints: 0,
    lifetimeXP: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: new Date()
  });

  // 3. Child
  const childRef = doc(db, 'users', "child_1");
  batch.set(childRef, {
    uid: "child_1",
    familyId: familyId,
    role: "child",
    displayName: "Leo",
    avatarUrl: "https://i.pravatar.cc/150?u=1",
    walletBalance: 2450, // cents = $24.50
    rewardPoints: 1250,
    lifetimeXP: 3400,
    currentStreak: 5,
    longestStreak: 12,
    lastActiveDate: new Date()
  });

  // 4. Tasks
  const task1Ref = doc(collection(db, `families/${familyId}/tasks`));
  batch.set(task1Ref, {
    title: "Clean your room",
    description: "Put all toys away.",
    type: "daily",
    pointsReward: 50,
    requiresApproval: true,
    isActive: true
  });

  // 5. Rewards
  const reward1Ref = doc(collection(db, `families/${familyId}/rewards`));
  batch.set(reward1Ref, {
    title: "1 Hour of Video Games",
    category: "screen-time",
    cost: 150,
    icon: "🎮"
  });

  // 6. Activity Feed
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  batch.set(feedRef, {
    actorId: "child_1",
    text: "Completed task: Clean your room (+50 pts)",
    timestamp: new Date()
  });

  await batch.commit();
  console.log("Database Seeded Successfully!");
}

// Uncomment to run if executing in a suitable environment
// seedDatabase().catch(console.error);

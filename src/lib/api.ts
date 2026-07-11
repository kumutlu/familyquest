import { 
  collection, doc, getDoc, setDoc, updateDoc, 
  addDoc, runTransaction, query, where, getDocs, serverTimestamp 
} from 'firebase/firestore';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut as firebaseSignOut 
} from 'firebase/auth';
import { db, auth } from './firebase';

// ---------------------------
// 0. AUTHENTICATION
// ---------------------------

export const signUp = async (email: string, pass: string, name: string) => {
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  // Create user doc without familyId first
  await setDoc(doc(db, 'users', cred.user.uid), {
    uid: cred.user.uid,
    role: 'parent', // default role
    displayName: name,
    avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
    walletBalance: 0,
    rewardPoints: 0,
    lifetimeXP: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: serverTimestamp()
  });
  return cred.user;
};

export const signIn = async (email: string, pass: string) => {
  return signInWithEmailAndPassword(auth, email, pass);
};

export const signOut = () => firebaseSignOut(auth);

// ---------------------------
// 1. FAMILIES & USERS
// ---------------------------

export const createFamilyAndParent = async (uid: string, name: string, familyName: string) => {
  const familyRef = doc(collection(db, 'families'));
  const userRef = doc(db, 'users', uid);
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  await runTransaction(db, async (transaction) => {
    transaction.set(familyRef, {
      name: familyName,
      inviteCode,
      createdAt: serverTimestamp()
    });
    
    transaction.set(userRef, {
      uid,
      familyId: familyRef.id,
      role: 'parent',
      displayName: name,
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
      walletBalance: 0,
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: serverTimestamp()
    });
  });
  
  return { familyId: familyRef.id, inviteCode };
};

export const joinFamilyAsChild = async (uid: string, name: string, inviteCode: string) => {
  const q = query(collection(db, 'families'), where('inviteCode', '==', inviteCode));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error('Invalid invite code');
  
  const familyId = snap.docs[0].id;
  
  await setDoc(doc(db, 'users', uid), {
    uid,
    familyId,
    role: 'child',
    displayName: name,
    avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${name}`,
    walletBalance: 0,
    rewardPoints: 0,
    lifetimeXP: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: serverTimestamp()
  });

  return familyId;
};

// ---------------------------
// 2. TASKS & COMPLETIONS
// ---------------------------

export const createTask = async (familyId: string, taskData: any) => {
  return addDoc(collection(db, `families/${familyId}/tasks`), {
    ...taskData,
    isActive: true
  });
};

export const completeTask = async (familyId: string, taskId: string, userId: string, requiresApproval: boolean) => {
  const completionRef = doc(collection(db, `families/${familyId}/task_completions`));
  const status = requiresApproval ? 'pending_approval' : 'approved';
  
  await setDoc(completionRef, {
    taskId,
    assigneeId: userId,
    status,
    completedAt: serverTimestamp(),
    approvedAt: requiresApproval ? null : serverTimestamp()
  });

  // If no approval required, points should be awarded immediately (optimistic UI handles local state)
  if (!requiresApproval) {
    const taskSnap = await getDoc(doc(db, `families/${familyId}/tasks/${taskId}`));
    if (taskSnap.exists()) {
      const pts = taskSnap.data().pointsReward || 0;
      if (pts > 0) {
        await awardPoints(familyId, userId, pts, `Completed task: ${taskSnap.data().title}`);
      }
    }
  }
  return completionRef.id;
};

export const approveTaskCompletion = async (familyId: string, completionId: string, taskId: string, userId: string, comment?: string) => {
  const completionRef = doc(db, `families/${familyId}/task_completions`, completionId);
  const taskRef = doc(db, `families/${familyId}/tasks`, taskId);
  
  await runTransaction(db, async (transaction) => {
    const taskDoc = await transaction.get(taskRef);
    if (!taskDoc.exists()) throw new Error("Task not found");
    const points = taskDoc.data().pointsReward || 0;

    transaction.update(completionRef, {
      status: 'approved',
      parentComment: comment || null,
      approvedAt: serverTimestamp()
    });

    if (points > 0) {
      const userRef = doc(db, 'users', userId);
      const userDoc = await transaction.get(userRef);
      if (userDoc.exists()) {
        const currentPoints = userDoc.data().rewardPoints || 0;
        const currentXP = userDoc.data().lifetimeXP || 0;
        transaction.update(userRef, {
          rewardPoints: currentPoints + points,
          lifetimeXP: currentXP + points
        });
      }
    }

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: userId,
      text: `Task approved: ${taskDoc.data().title} (+${points} pts)${comment ? ` - "${comment}"` : ''}`,
      timestamp: serverTimestamp()
    });
  });
};

export const rejectTaskCompletion = async (familyId: string, completionId: string, taskId: string, userId: string, comment: string) => {
  const completionRef = doc(db, `families/${familyId}/task_completions`, completionId);
  const taskRef = doc(db, `families/${familyId}/tasks`, taskId);

  await runTransaction(db, async (transaction) => {
    const taskDoc = await transaction.get(taskRef);
    if (!taskDoc.exists()) throw new Error("Task not found");

    transaction.update(completionRef, {
      status: 'rejected',
      parentComment: comment,
      rejectedAt: serverTimestamp()
    });

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: userId,
      text: `Task rejected: ${taskDoc.data().title} - "${comment}"`,
      timestamp: serverTimestamp()
    });
  });
};

// ---------------------------
// 3. BEHAVIOUR EVENTS
// ---------------------------

export const addBehaviourEvent = async (familyId: string, userId: string, authorId: string, title: string, pointsDelta: number) => {
  const userRef = doc(db, 'users', userId);
  const eventRef = doc(collection(db, `families/${familyId}/behaviour_events`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));

  await runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error("User not found");
    
    // Ensure points don't drop below 0 if negative
    const newPoints = Math.max(0, (userDoc.data().rewardPoints || 0) + pointsDelta);
    
    transaction.set(eventRef, {
      userId,
      authorId,
      title,
      pointsDelta,
      timestamp: serverTimestamp()
    });

    transaction.update(userRef, { rewardPoints: newPoints });

    transaction.set(feedRef, {
      actorId: authorId,
      text: `Gave ${pointsDelta > 0 ? '+' : ''}${pointsDelta} pts to user for: ${title}`,
      timestamp: serverTimestamp()
    });
  });
};

// ---------------------------
// 4. REWARDS & REDEMPTIONS
// ---------------------------

export const redeemReward = async (familyId: string, userId: string, rewardId: string) => {
  const rewardRef = doc(db, `families/${familyId}/rewards`, rewardId);
  const userRef = doc(db, 'users', userId);
  const redemptionRef = doc(collection(db, `families/${familyId}/redemptions`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));

  await runTransaction(db, async (transaction) => {
    const [rewardDoc, userDoc] = await Promise.all([
      transaction.get(rewardRef),
      transaction.get(userRef)
    ]);
    
    if (!rewardDoc.exists() || !userDoc.exists()) throw new Error("Not found");
    
    const cost = rewardDoc.data().cost;
    const currentPoints = userDoc.data().rewardPoints || 0;
    
    if (currentPoints < cost) {
      throw new Error("Not enough points");
    }

    transaction.update(userRef, { rewardPoints: currentPoints - cost });
    
    transaction.set(redemptionRef, {
      rewardId,
      userId,
      costPaid: cost,
      redeemedAt: serverTimestamp()
    });

    transaction.set(feedRef, {
      actorId: userId,
      text: `Redeemed reward: ${rewardDoc.data().title}`,
      timestamp: serverTimestamp()
    });
  });
};

// Helper for awarding points safely outside of task approval
export const awardPoints = async (familyId: string, userId: string, points: number, reason: string) => {
  const userRef = doc(db, 'users', userId);
  const feedRef = doc(collection(db, `families/${familyId}/feed`));

  await runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) return;
    
    const currentPoints = userDoc.data().rewardPoints || 0;
    const currentXP = userDoc.data().lifetimeXP || 0;
    
    transaction.update(userRef, {
      rewardPoints: currentPoints + points,
      lifetimeXP: currentXP + points
    });

    transaction.set(feedRef, {
      actorId: userId,
      text: reason,
      timestamp: serverTimestamp()
    });
  });
};

export const updateTask = async (familyId: string, taskId: string, data: any) => {
  return updateDoc(doc(db, `families/${familyId}/tasks`, taskId), data);
};

export const createReward = async (familyId: string, data: any) => {
  return addDoc(collection(db, `families/${familyId}/rewards`), data);
};

export const updateReward = async (familyId: string, rewardId: string, data: any) => {
  return updateDoc(doc(db, `families/${familyId}/rewards`, rewardId), data);
};

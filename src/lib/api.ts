import { 
  collection, doc, setDoc, updateDoc, 
  addDoc, runTransaction, query, where, getDocs, getDoc, serverTimestamp 
} from 'firebase/firestore';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signInWithPopup,
  signOut as firebaseSignOut 
} from 'firebase/auth';
import { db, auth, googleProvider } from './firebase';
import { calculateBehaviourEffect, DEFAULT_DEBT_LIMIT_PENCE } from './behaviour';
import type { BehaviourEventInput } from './behaviour';

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

export const signInWithGoogle = async () => {
  const cred = await signInWithPopup(auth, googleProvider);
  
  // Check if user doc exists
  const userDocRef = doc(db, 'users', cred.user.uid);
  const userSnap = await getDoc(userDocRef);
  
  if (!userSnap.exists()) {
    // Create new user document defaulting to 'parent' role
    await setDoc(userDocRef, {
      uid: cred.user.uid,
      role: 'parent',
      displayName: cred.user.displayName || 'User',
      avatarUrl: cred.user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${cred.user.displayName || 'User'}`,
      walletBalance: 0,
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: serverTimestamp()
    });
  }
  
  return cred.user;
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
  const code = inviteCode.toUpperCase().trim();
  const q = query(collection(db, 'families'), where('inviteCode', '==', code));
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
  const docRef = await addDoc(collection(db, `families/${familyId}/tasks`), {
    ...taskData,
    isActive: true,
    createdAt: serverTimestamp()
  });
  await addDoc(collection(db, `families/${familyId}/feed`), {
    actorId: 'system',
    text: `New task added: ${taskData.title}`,
    timestamp: serverTimestamp()
  });
  return docRef;
};

export const completeTask = async (familyId: string, taskId: string, userId: string, requiresApproval: boolean) => {
  await runTransaction(db, async (transaction) => {
    // 1. Evaluate user streak
    const userRef = doc(db, 'users', userId);
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error("User not found");
    const userData = userDoc.data();
    
    const lastActiveTimestamp = userData.lastActiveDate;
    const lastActive = lastActiveTimestamp ? lastActiveTimestamp.toDate() : new Date(0);
    const today = new Date();
    today.setHours(0,0,0,0);
    const lastActiveDay = new Date(lastActive);
    lastActiveDay.setHours(0,0,0,0);

    const diffTime = today.getTime() - lastActiveDay.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    let newCurrentStreak = userData.currentStreak || 0;
    let newLongestStreak = userData.longestStreak || 0;

    if (diffDays === 1) {
      newCurrentStreak += 1;
      if (newCurrentStreak > newLongestStreak) newLongestStreak = newCurrentStreak;
    } else if (diffDays > 1) {
      newCurrentStreak = 1;
      if (newCurrentStreak > newLongestStreak) newLongestStreak = newCurrentStreak;
    } else if (diffDays === 0) {
      if (newCurrentStreak === 0) {
        newCurrentStreak = 1;
        if (newCurrentStreak > newLongestStreak) newLongestStreak = newCurrentStreak;
      }
    }

    let finalRewardPoints = userData.rewardPoints || 0;
    let finalLifetimeXP = userData.lifetimeXP || 0;

    // 2. Mark task completion
    const completionRef = doc(collection(db, `families/${familyId}/task_completions`));
    const status = requiresApproval ? 'pending_approval' : 'approved';
    transaction.set(completionRef, {
      taskId,
      assigneeId: userId,
      status,
      completedAt: serverTimestamp(),
      approvedAt: requiresApproval ? null : serverTimestamp()
    });

    // 3. Auto-award if no approval required
    if (!requiresApproval) {
      const taskRef = doc(db, `families/${familyId}/tasks`, taskId);
      const taskSnap = await transaction.get(taskRef);
      if (taskSnap.exists()) {
        const pts = taskSnap.data().pointsReward || 0;
        if (pts > 0) {
          finalRewardPoints += pts;
          finalLifetimeXP += pts;
          const feedRef = doc(collection(db, `families/${familyId}/feed`));
          transaction.set(feedRef, {
            actorId: userId,
            text: `Completed task: ${taskSnap.data().title} (+${pts} pts)`,
            timestamp: serverTimestamp()
          });
        }
      }
    }

    // 4. Update user doc with streak and points
    transaction.update(userRef, {
      currentStreak: newCurrentStreak,
      longestStreak: newLongestStreak,
      lastActiveDate: serverTimestamp(),
      rewardPoints: finalRewardPoints,
      lifetimeXP: finalLifetimeXP
    });
  });
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

export function addBehaviourEvent(
  familyId: string,
  childId: string,
  createdBy: string,
  input: BehaviourEventInput,
): Promise<string>;
/** @deprecated Use the BehaviourEventInput overload. */
export function addBehaviourEvent(
  familyId: string,
  childId: string,
  createdBy: string,
  reason: string,
  pointsDelta: number,
): Promise<string>;
export async function addBehaviourEvent(
  familyId: string,
  childId: string,
  createdBy: string,
  inputOrReason: BehaviourEventInput | string,
  legacyPointsDelta?: number,
): Promise<string> {
  const input: BehaviourEventInput = typeof inputOrReason === 'string'
    ? {
        type: (legacyPointsDelta ?? 0) >= 0 ? 'positive' : 'negative',
        reason: inputOrReason,
        pointsDelta: legacyPointsDelta ?? 0,
        walletDelta: 0,
      }
    : inputOrReason;
  const familyRef = doc(db, 'families', familyId);
  const childRef = doc(db, 'users', childId);
  const creatorRef = doc(db, 'users', createdBy);
  const eventRef = doc(collection(db, `families/${familyId}/behaviour_events`));
  const ledgerRef = input.type === 'financial'
    ? doc(collection(db, `families/${familyId}/wallet_transactions`))
    : null;
  const feedRef = doc(collection(db, `families/${familyId}/feed`));

  await runTransaction(db, async (transaction) => {
    const familyDoc = await transaction.get(familyRef);
    const childDoc = await transaction.get(childRef);
    const creatorDoc = await transaction.get(creatorRef);

    if (!familyDoc.exists()) throw new Error('Family not found.');
    if (!childDoc.exists()) throw new Error('Child not found.');
    if (!creatorDoc.exists()) throw new Error('Creator not found.');

    const child = childDoc.data();
    const creator = creatorDoc.data();
    if (child.familyId !== familyId) throw new Error('Child does not belong to this family.');
    if (child.role !== 'child') throw new Error('Behaviour events can only target a child.');
    if (creator.familyId !== familyId) throw new Error('Creator does not belong to this family.');
    if (creator.role !== 'parent' && creator.role !== 'owner') {
      throw new Error('Only a parent or owner can create behaviour events.');
    }

    const effect = calculateBehaviourEffect(
      input,
      {
        rewardPoints: child.rewardPoints ?? 0,
        lifetimeXP: child.lifetimeXP ?? 0,
        walletBalance: child.walletBalance ?? 0,
      },
      familyDoc.data().debtLimitPence ?? DEFAULT_DEBT_LIMIT_PENCE,
    );

    if (input.type === 'positive') {
      transaction.update(childRef, { rewardPoints: effect.rewardPoints, lifetimeXP: effect.lifetimeXP });
    } else if (input.type === 'negative') {
      transaction.update(childRef, { rewardPoints: effect.rewardPoints });
    } else {
      transaction.update(childRef, { walletBalance: effect.walletBalance });
    }

    transaction.set(eventRef, {
      familyId,
      childId,
      type: input.type,
      reason: input.reason.trim(),
      pointsDelta: effect.pointsDelta,
      walletDelta: effect.walletDelta,
      createdBy,
      createdByName: creator.displayName,
      createdAt: serverTimestamp(),
    });

    if (ledgerRef) {
      transaction.set(ledgerRef, {
        type: 'financial_penalty',
        behaviourEventId: eventRef.id,
        childId,
        amount: -effect.walletDelta,
        reason: input.reason.trim(),
        createdBy,
        createdByName: creator.displayName,
        createdAt: serverTimestamp(),
      });
    }

    const deltaText = input.type === 'financial'
      ? `-£${(-effect.walletDelta / 100).toFixed(2)}`
      : `${effect.pointsDelta > 0 ? '+' : ''}${effect.pointsDelta} pts`;
    const feedTimestamp = serverTimestamp();
    transaction.set(feedRef, {
      actorId: createdBy,
      text: `Logged behaviour for ${child.displayName}: ${input.reason.trim()} (${deltaText})`,
      createdAt: feedTimestamp,
      timestamp: feedTimestamp,
    });
  });

  return eventRef.id;
}

export const updateDebtLimit = async (
  familyId: string,
  ownerId: string,
  debtLimitPence: number,
): Promise<void> => {
  if (!Number.isSafeInteger(debtLimitPence) || debtLimitPence >= 0) {
    throw new Error('Debt limit must be a negative integer number of pence.');
  }

  await updateDoc(doc(db, 'families', familyId), {
    debtLimitPence,
    updatedBy: ownerId,
    updatedAt: serverTimestamp(),
  });
};

// ---------------------------
// 4. FAMILY CHALLENGES
// ---------------------------

export const createChallenge = async (familyId: string, title: string, targetXP: number, rewardPoints: number, startXP: number) => {
  return addDoc(collection(db, `families/${familyId}/challenges`), {
    title,
    targetXP,
    rewardPoints,
    startXP,
    isActive: true,
    createdAt: serverTimestamp()
  });
};

export const claimChallenge = async (familyId: string, challengeId: string, rewardPoints: number, childrenIds: string[], challengeTitle: string) => {
  const challengeRef = doc(db, `families/${familyId}/challenges`, challengeId);
  
  await runTransaction(db, async (transaction) => {
    const challengeDoc = await transaction.get(challengeRef);
    if (!challengeDoc.exists() || !challengeDoc.data().isActive) throw new Error("Challenge not active");

    transaction.update(challengeRef, {
      isActive: false,
      completedAt: serverTimestamp()
    });

    for (const childId of childrenIds) {
      const userRef = doc(db, 'users', childId);
      const userDoc = await transaction.get(userRef);
      if (userDoc.exists()) {
        transaction.update(userRef, {
          rewardPoints: (userDoc.data().rewardPoints || 0) + rewardPoints,
          lifetimeXP: (userDoc.data().lifetimeXP || 0) + rewardPoints
        });
      }
    }

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: 'system',
      text: `Family Challenge Completed: ${challengeTitle}! Everyone got +${rewardPoints} pts!`,
      timestamp: serverTimestamp()
    });
  });
};

// ---------------------------
// 5. REWARDS & REDEMPTIONS
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
  const docRef = await addDoc(collection(db, `families/${familyId}/rewards`), {
    ...data,
    createdAt: serverTimestamp()
  });
  await addDoc(collection(db, `families/${familyId}/feed`), {
    actorId: 'system',
    text: `New reward added: ${data.title}`,
    timestamp: serverTimestamp()
  });
  return docRef;
};

export const updateReward = async (familyId: string, rewardId: string, data: any) => {
  return updateDoc(doc(db, `families/${familyId}/rewards`, rewardId), data);
};

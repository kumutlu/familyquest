import {
  collection, doc, setDoc, updateDoc,
  addDoc, runTransaction, query, where, getDocs, getDoc, serverTimestamp, deleteDoc, writeBatch
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
import { reviewerFields, transferApprovalRequestUpdate } from './approvalContracts';

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

    transaction.set(doc(db, `families/${familyRef.id}/wallets`, uid), { balance: 0 });
    transaction.set(userRef, {
      uid,
      familyId: familyRef.id,
      role: 'owner',
      displayName: name,
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: serverTimestamp()
    }, { merge: true });
  });

  return { familyId: familyRef.id, inviteCode };
};

export const requestToJoinFamily = async (uid: string, name: string, inviteCode: string) => {
  const code = inviteCode.toUpperCase().trim();
  const q = query(collection(db, 'families'), where('inviteCode', '==', code));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error('Invalid invite code');

  const familyId = snap.docs[0].id;

  await setDoc(doc(db, `families/${familyId}/join_requests`, uid), {
    uid,
    displayName: name,
    status: 'pending',
    createdAt: serverTimestamp()
  });

  return familyId;
};

export const approveJoinRequest = async (familyId: string, uid: string, role: 'parent' | 'child', displayName: string) => {
  const reviewerUid = auth.currentUser?.uid;
  if (!reviewerUid) throw new Error('Not authenticated');
  await runTransaction(db, async (transaction) => {
    const userRef = doc(db, 'users', uid);
    const requestRef = doc(db, `families/${familyId}/join_requests`, uid);
    const reviewerRef = doc(db, 'users', reviewerUid);
    const [requestDoc, reviewerDoc] = await Promise.all([transaction.get(requestRef), transaction.get(reviewerRef)]);
    if (!requestDoc.exists() || requestDoc.data().status !== 'pending') throw new Error('Join request is not pending');
    if (!reviewerDoc.exists() || reviewerDoc.data().familyId !== familyId || reviewerDoc.data().role !== 'owner') throw new Error('Only the family owner can review join requests');

    if (role === 'child') {
      transaction.set(doc(db, `families/${familyId}/wallets`, uid), {
        balance: 0, createdAt: serverTimestamp(), migratedFromLegacy: true,
      }, { merge: true });
    }
    transaction.set(userRef, {
      uid,
      familyId,
      role,
      displayName,
      avatarUrl: `https://api.dicebear.com/7.x/${role === 'parent' ? 'avataaars' : 'bottts'}/svg?seed=${displayName}`,
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: serverTimestamp()
    }, { merge: true });

    transaction.update(requestRef, {
      status: 'approved', assignedRole: role,
      ...reviewerFields(reviewerUid, reviewerDoc.data().displayName || 'Owner', serverTimestamp()),
    });
    transaction.set(doc(collection(db, `families/${familyId}/feed`)), {
      actorId: reviewerUid, type: 'custom',
      text: `${displayName} has joined the family as a ${role}!`, timestamp: serverTimestamp(),
    });
  });
};

export const rejectJoinRequest = async (familyId: string, uid: string) => {
  const reviewerUid = auth.currentUser?.uid;
  if (!reviewerUid) throw new Error('Not authenticated');
  await runTransaction(db, async transaction => {
    const requestRef = doc(db, `families/${familyId}/join_requests`, uid);
    const reviewerRef = doc(db, 'users', reviewerUid);
    const [requestDoc, reviewerDoc] = await Promise.all([transaction.get(requestRef), transaction.get(reviewerRef)]);
    if (!requestDoc.exists() || requestDoc.data().status !== 'pending') throw new Error('Join request is not pending');
    if (!reviewerDoc.exists() || reviewerDoc.data().familyId !== familyId || reviewerDoc.data().role !== 'owner') throw new Error('Only the family owner can review join requests');
    transaction.update(requestRef, {
      status: 'rejected', ...reviewerFields(reviewerUid, reviewerDoc.data().displayName || 'Owner', serverTimestamp()),
    });
  });
};

export const updateMemberRole = async (uid: string, newRole: 'parent' | 'child' | 'owner') => {
  await updateDoc(doc(db, 'users', uid), { role: newRole });
};

export const removeMember = async (uid: string) => {
  await updateDoc(doc(db, 'users', uid), {
    familyId: null,
    role: 'parent' // Reset to default
  });
};

export const createManagedMember = async (familyId: string, role: 'parent' | 'child', displayName: string) => {
  const userRef = doc(collection(db, 'users'));
  const batch = writeBatch(db);
  batch.set(doc(db, `families/${familyId}/wallets`, userRef.id), {
    balance: 0,
    createdAt: serverTimestamp(),
    migratedFromLegacy: true
  });
  batch.set(userRef, {
    uid: userRef.id,
    familyId,
    role,
    displayName,
    isManaged: true,
    avatarUrl: `https://api.dicebear.com/7.x/${role === 'parent' ? 'avataaars' : 'bottts'}/svg?seed=${displayName}`,
    rewardPoints: 0,
    lifetimeXP: 0,
    currentStreak: 0,
    longestStreak: 0,
    walletBalance: 0,
    lastActiveDate: serverTimestamp()
  });
  await batch.commit();
  return userRef.id;
};

// ---------------------------
// 1.5 ACCOUNT CLAIMING
// ---------------------------

export const generateClaimCode = async (familyId: string, managedUserId: string) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  await setDoc(doc(db, `claim_codes`, result), {
    familyId,
    managedUserId,
    createdAt: serverTimestamp()
  });

  return result;
};

export const submitClaimRequest = async (uid: string, displayName: string, claimCode: string) => {
  const code = claimCode.toUpperCase().trim();

  const claimDoc = await getDoc(doc(db, 'claim_codes', code));
  if (!claimDoc.exists()) throw new Error('Invalid claim code');

  const familyId = claimDoc.data().familyId;
  if (!familyId) throw new Error('Invalid claim code structure');

  await setDoc(doc(db, `families/${familyId}/join_requests`, uid), {
    uid,
    displayName,
    claimCode: code,
    claimUserId: claimDoc.data().managedUserId,
    status: 'pending',
    createdAt: serverTimestamp()
  });

  return familyId;
};

export const approveClaimRequest = async (familyId: string, uid: string, role: 'parent' | 'child', displayName: string, claimUserId: string, claimCode: string) => {
  // We must do a massive migration here. Since it involves multiple queries, we cannot do it all in a single transaction if it exceeds limits, but a batch is better.
  const batch = writeBatch(db);

  // 1. Read old user data
  const oldUserDoc = await getDoc(doc(db, 'users', claimUserId));
  if (!oldUserDoc.exists()) throw new Error('Managed user not found');
  const oldUserData = oldUserDoc.data();

  // 2. Set new user data
  batch.set(doc(db, 'users', uid), {
    uid,
    familyId,
    role,
    displayName,
    avatarUrl: oldUserData.avatarUrl,
    rewardPoints: oldUserData.rewardPoints || 0,
    lifetimeXP: oldUserData.lifetimeXP || 0,
    currentStreak: oldUserData.currentStreak || 0,
    longestStreak: oldUserData.longestStreak || 0,
    lastActiveDate: serverTimestamp()
  }, { merge: true });

  // 3. Migrate task_completions
  const completionsQ = query(collection(db, `families/${familyId}/task_completions`), where('assigneeId', '==', claimUserId));
  const completionsSnap = await getDocs(completionsQ);
  completionsSnap.forEach(d => batch.update(d.ref, { assigneeId: uid }));

  // 4. Migrate wallet_transactions
  const txQ = query(collection(db, `families/${familyId}/wallet_transactions`), where('userId', '==', claimUserId));
  const txSnap = await getDocs(txQ);
  txSnap.forEach(d => batch.update(d.ref, { userId: uid }));

  // 5. Migrate savings_goals
  const goalsQ = query(collection(db, `families/${familyId}/savings_goals`), where('userId', '==', claimUserId));
  const goalsSnap = await getDocs(goalsQ);
  goalsSnap.forEach(d => batch.update(d.ref, { userId: uid }));

  // 6. Migrate feed
  const feedQ = query(collection(db, `families/${familyId}/feed`), where('actorId', '==', claimUserId));
  const feedSnap = await getDocs(feedQ);
  feedSnap.forEach(d => batch.update(d.ref, { actorId: uid }));

  // 7. Migrate behaviour_events
  const eventsQ = query(collection(db, `families/${familyId}/behaviour_events`), where('userId', '==', claimUserId));
  const eventsSnap = await getDocs(eventsQ);
  eventsSnap.forEach(d => batch.update(d.ref, { userId: uid }));

  // 8. Delete old user, claim code, and join request
  batch.delete(doc(db, 'users', claimUserId));
  batch.delete(doc(db, `claim_codes`, claimCode));
  batch.delete(doc(db, `families/${familyId}/join_requests`, uid));

  // 9. Add feed event
  batch.set(doc(collection(db, `families/${familyId}/feed`)), {
    actorId: 'system',
    text: `${displayName} has fully joined the family!`,
    timestamp: serverTimestamp()
  });

  await batch.commit();
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

    // READ task if auto-awarding
    let taskSnap: any = null;
    if (!requiresApproval) {
      const taskRef = doc(db, `families/${familyId}/tasks`, taskId);
      taskSnap = await transaction.get(taskRef);
    }

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
    if (!requiresApproval && taskSnap && taskSnap.exists()) {
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

export const approveTaskCompletion = async (familyId: string, completionId: string, comment?: string) => {
  const completionRef = doc(db, `families/${familyId}/task_completions`, completionId);
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error('Not authenticated');

  await runTransaction(db, async (transaction) => {
    const completionDoc = await transaction.get(completionRef);
    if (!completionDoc.exists()) throw new Error('Completion not found');
    const completion = completionDoc.data();
    if (completion.status !== 'pending_approval') throw new Error('Completion is not pending approval');

    const taskRef = doc(db, `families/${familyId}/tasks`, completion.taskId);
    const userRef = doc(db, 'users', completion.assigneeId);
    const reviewerRef = doc(db, 'users', currentUserUid);
    const [taskDoc, userDoc, reviewerDoc] = await Promise.all([
      transaction.get(taskRef), transaction.get(userRef), transaction.get(reviewerRef),
    ]);
    if (!taskDoc.exists()) throw new Error("Task not found");
    if (!userDoc.exists() || userDoc.data().familyId !== familyId || userDoc.data().role !== 'child') throw new Error('Assignee is not a child in this family');
    if (!reviewerDoc.exists() || reviewerDoc.data().familyId !== familyId || !['parent', 'owner'].includes(reviewerDoc.data().role)) throw new Error('Reviewer is not a parent or owner in this family');
    const points = taskDoc.data().pointsReward || 0;

    transaction.update(completionRef, {
      status: 'approved',
      parentComment: comment || null,
      approvedAt: serverTimestamp(),
      awardedPoints: points,
      ...reviewerFields(currentUserUid, reviewerDoc.data().displayName || 'Parent', serverTimestamp()),
    });

    if (points > 0) {
      const currentPoints = userDoc.data().rewardPoints || 0;
      const currentXP = userDoc.data().lifetimeXP || 0;
      transaction.update(userRef, {
        rewardPoints: currentPoints + points,
        lifetimeXP: currentXP + points
      });
    }

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Task approved: ${taskDoc.data().title} (+${points} pts)${comment ? ` - "${comment}"` : ''}`,
      timestamp: serverTimestamp()
    });
  });
};

export const rejectTaskCompletion = async (familyId: string, completionId: string, comment: string) => {
  const completionRef = doc(db, `families/${familyId}/task_completions`, completionId);
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error('Not authenticated');

  await runTransaction(db, async (transaction) => {
    const completionDoc = await transaction.get(completionRef);
    if (!completionDoc.exists()) throw new Error('Completion not found');
    const completion = completionDoc.data();
    if (completion.status !== 'pending_approval') throw new Error('Completion is not pending approval');
    const taskRef = doc(db, `families/${familyId}/tasks`, completion.taskId);
    const reviewerRef = doc(db, 'users', currentUserUid);
    const [taskDoc, reviewerDoc] = await Promise.all([transaction.get(taskRef), transaction.get(reviewerRef)]);
    if (!taskDoc.exists()) throw new Error("Task not found");
    if (!reviewerDoc.exists() || reviewerDoc.data().familyId !== familyId || !['parent', 'owner'].includes(reviewerDoc.data().role)) throw new Error('Reviewer is not a parent or owner in this family');

    transaction.update(completionRef, {
      status: 'rejected',
      parentComment: comment,
      rejectedAt: serverTimestamp(),
      ...reviewerFields(currentUserUid, reviewerDoc.data().displayName || 'Parent', serverTimestamp()),
    });

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Task rejected: ${taskDoc.data().title} - "${comment}"`,
      timestamp: serverTimestamp()
    });
  });
};

// ---------------------------
// 3. BEHAVIOUR EVENTS
// ---------------------------

export async function addBehaviourEvent(
  familyId: string,
  childId: string,
  createdBy: string,
  input: BehaviourEventInput,
): Promise<string> {
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
    const walletRef = doc(db, `families/${familyId}/wallets`, childId);
    const walletDoc = await transaction.get(walletRef);
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
        walletBalance: walletDoc.exists() ? (walletDoc.data().balance ?? 0) : 0,
      },
      familyDoc.data().debtLimitPence ?? DEFAULT_DEBT_LIMIT_PENCE,
    );

    if (input.type === 'positive') {
      transaction.update(childRef, { rewardPoints: effect.rewardPoints, lifetimeXP: effect.lifetimeXP });
    } else if (input.type === 'negative') {
      transaction.update(childRef, { rewardPoints: effect.rewardPoints });
    } else {
      transaction.update(walletRef, { balance: effect.walletBalance });
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
      type: 'behaviour',
      behaviourType: input.type,
      reason: input.reason.trim(),
      pointsDelta: effect.pointsDelta,
      walletDelta: effect.walletDelta,
      childId: childId,
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
    transaction.update(userRef, {
      rewardPoints: currentPoints - cost,
      lastRedemptionId: redemptionRef.id
    });

    transaction.set(redemptionRef, {
      rewardId,
      userId,
      costPaid: cost,
      redeemedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      status: 'completed',
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

export const updateTask = async (familyId: string, taskId: string, updates: any) => {
  const taskRef = doc(db, `families/${familyId}/tasks`, taskId);
  await updateDoc(taskRef, updates);
};

export const deleteTask = async (familyId: string, taskId: string) => {
  const taskRef = doc(db, `families/${familyId}/tasks`, taskId);
  await deleteDoc(taskRef);
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

export const deleteReward = async (familyId: string, rewardId: string) => {
  return deleteDoc(doc(db, `families/${familyId}/rewards`, rewardId));
};

// ---------------------------
// 6. WALLET & SAVINGS
// ---------------------------

export const ensureWalletDocument = async (
  transaction: any,
  familyId: string,
  childId: string,
  userSnapshot: any
): Promise<number> => {
  const walletRef = doc(db, `families/${familyId}/wallets`, childId);
  const walletDoc = await transaction.get(walletRef);

  if (walletDoc.exists()) {
    return walletDoc.data().balance || 0;
  }

  const userData = userSnapshot.data();
  const legacyBalance = Number.isInteger(userData.walletBalance) ? userData.walletBalance : 0;
  transaction.set(walletRef, {
    balance: legacyBalance,
    createdAt: serverTimestamp(),
    migratedFromLegacy: true
  });

  return legacyBalance;
};

export const depositToWallet = async (familyId: string, childId: string, parentId: string, amount: number, note: string) => {
  const childWalletRef = doc(db, `families/${familyId}/wallets`, childId);
  const txRef = doc(collection(db, `families/${familyId}/wallet_transactions`));

  await runTransaction(db, async (transaction) => {
    const userRef = doc(db, 'users', childId);
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error("User not found");
    const currentBalance = await ensureWalletDocument(transaction, familyId, childId, userDoc);

    transaction.set(childWalletRef, { balance: currentBalance + amount, lastManualTxId: txRef.id }, { merge: true });

    transaction.set(txRef, {
      type: 'deposit',
      childId,
      amount,
      note,
      parentRef: parentId,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp()
    });
  });
};

export const withdrawFromWallet = async (familyId: string, childId: string, parentId: string, amount: number, note: string) => {
  const childWalletRef = doc(db, `families/${familyId}/wallets`, childId);
  const txRef = doc(collection(db, `families/${familyId}/wallet_transactions`));

  await runTransaction(db, async (transaction) => {
    const userRef = doc(db, 'users', childId);
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error("User not found");
    const currentBalance = await ensureWalletDocument(transaction, familyId, childId, userDoc);

    if (currentBalance < amount) throw new Error("Insufficient funds");

    transaction.set(childWalletRef, { balance: currentBalance - amount, lastManualTxId: txRef.id }, { merge: true });

    transaction.set(txRef, {
      type: 'withdrawal',
      childId,
      amount,
      note,
      parentRef: parentId,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp()
    });
  });
};

export const transferWalletFunds = async (familyId: string, fromChildId: string, toChildId: string, parentId: string, amount: number, note: string) => {
  const fromWalletRef = doc(db, `families/${familyId}/wallets`, fromChildId);
  const toWalletRef = doc(db, `families/${familyId}/wallets`, toChildId);
  const txRef = doc(collection(db, `families/${familyId}/wallet_transactions`));

  await runTransaction(db, async (transaction) => {
    const [fromWalletDoc, toWalletDoc] = await Promise.all([
      transaction.get(fromWalletRef),
      transaction.get(toWalletRef)
    ]);

    const fromBalance = fromWalletDoc.exists() ? (fromWalletDoc.data().balance || 0) : 0;
    const toBalance = toWalletDoc.exists() ? (toWalletDoc.data().balance || 0) : 0;

    if (fromBalance < amount) throw new Error("Insufficient funds");

    transaction.set(fromWalletRef, { balance: fromBalance - amount, lastManualTxId: txRef.id }, { merge: true });
    transaction.set(toWalletRef, { balance: toBalance + amount, lastManualTxId: txRef.id }, { merge: true });

    transaction.set(txRef, {
      type: 'transfer',
      childId: toChildId,
      fromChildId,
      amount,
      note,
      parentRef: parentId,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp()
    });
  });
};

export const createSavingsGoal = async (familyId: string, childId: string, title: string, targetAmount: number) => {
  return addDoc(collection(db, `families/${familyId}/savings_goals`), {
    childId,
    title,
    targetAmount,
    currentAmount: 0,
    createdAt: serverTimestamp()
  });
};

export const updateSavingsGoal = async (familyId: string, goalId: string, updates: any) => {
  return updateDoc(doc(db, `families/${familyId}/savings_goals`, goalId), updates);
};

export const deleteSavingsGoal = async (familyId: string, goalId: string) => {
  return deleteDoc(doc(db, `families/${familyId}/savings_goals`, goalId));
};

// ---------------------------
// 9. FUNDS & PET BOX
// ---------------------------

export const createFund = async (
  familyId: string,
  fundData: { type: string, name: string, species?: string, monthlyBudget: number, emergencyGoal?: number }
) => {
  const fundsRef = collection(db, `families/${familyId}/funds`);
  return addDoc(fundsRef, {
    ...fundData,
    balance: 0,
    createdAt: serverTimestamp()
  });
};

export const addFundExpense = async (
  familyId: string,
  fundId: string,
  expenseData: { amount: number, category: string, description: string, fundName: string }
) => {
  const fundRef = doc(db, `families/${familyId}/funds`, fundId);
  const txRef = doc(collection(db, `families/${familyId}/fund_transactions`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));

  await runTransaction(db, async (transaction) => {
    const fundDoc = await transaction.get(fundRef);
    if (!fundDoc.exists()) throw new Error("Fund not found");

    const currentBalance = fundDoc.data().balance || 0;

    transaction.update(fundRef, { balance: currentBalance - expenseData.amount });
    transaction.set(txRef, {
      fundId,
      type: "expense",
      amount: expenseData.amount,
      category: expenseData.category,
      description: expenseData.description,
      createdAt: serverTimestamp()
    });

    transaction.set(feedRef, {
      text: `Added £${(expenseData.amount/100).toFixed(2)} expense for ${expenseData.fundName}: ${expenseData.description}`,
      timestamp: serverTimestamp()
    });
  });
};

export const contributeToFund = async (
  familyId: string,
  fundId: string,
  userId: string,
  amount: number, // amount in pence
  fundName: string,
  userName: string
) => {
  const reqRef = doc(collection(db, `families/${familyId}/petbox_requests`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));

  await runTransaction(db, async (transaction) => {
    transaction.set(reqRef, {
      familyId,
      fundId,
      fundName,
      childId: userId,
      childName: userName,
      amountPence: amount,
      status: 'pending',
      createdAt: serverTimestamp()
    });

    transaction.set(feedRef, {
      actorId: userId,
      text: `${userName} wants to donate £${(amount/100).toFixed(2)} to ${fundName}. Awaiting parent approval.`,
      timestamp: serverTimestamp()
    });
  });
};

export const approvePetBoxDonation = async (familyId: string, requestId: string) => {
  const reqRef = doc(db, `families/${familyId}/petbox_requests`, requestId);
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");

  const approvalTxId = doc(collection(db, `families/${familyId}/wallet_transactions`)).id;
  const txRef = doc(collection(db, `families/${familyId}/fund_transactions`));
  const walletTxRef = doc(db, `families/${familyId}/wallet_transactions`, approvalTxId);

  await runTransaction(db, async (transaction) => {
    const reqDoc = await transaction.get(reqRef);
    if (!reqDoc.exists()) throw new Error("Request not found");
    const reqData = reqDoc.data();

    if (reqData.status !== 'pending') throw new Error("Request is not pending");

    const fundRef = doc(db, `families/${familyId}/funds`, reqData.fundId);
    const userWalletRef = doc(db, `families/${familyId}/wallets`, reqData.childId);
    const userRef = doc(db, 'users', reqData.childId);

    const [fundDoc, userDoc] = await Promise.all([
      transaction.get(fundRef),
      transaction.get(userRef)
    ]);

    if (!fundDoc.exists()) throw new Error("Fund not found");
    if (!userDoc.exists()) throw new Error("User not found");
    const currentWallet = await ensureWalletDocument(transaction, familyId, reqData.childId, userDoc);

    if (currentWallet < reqData.amountPence) throw new Error("Insufficient funds");

    const currentFundBalance = fundDoc.data().balance || 0;

    console.log('[petbox-approve] writing to user wallet:', userWalletRef.path, {
      balance: currentWallet - reqData.amountPence,
      lastTransferTxId: approvalTxId
    });
    transaction.set(userWalletRef, {
      balance: currentWallet - reqData.amountPence,
      lastTransferTxId: approvalTxId
    }, { merge: true });

    console.log('[petbox-approve] writing to user:', userRef.path, { lastFundTxId: txRef.id });
    transaction.update(userRef, { lastFundTxId: txRef.id });

    console.log('[petbox-approve] writing to fund:', fundRef.path, {
      balance: currentFundBalance + reqData.amountPence,
      lastFundTxId: txRef.id
    });
    transaction.update(fundRef, {
      balance: currentFundBalance + reqData.amountPence,
      lastFundTxId: txRef.id
    });

    console.log('[petbox-approve] writing to fund_transactions:', txRef.path, {
      fundId: reqData.fundId,
      type: "contribution",
      amount: reqData.amountPence,
      fromUserId: reqData.childId
    });
    transaction.set(txRef, {
      fundId: reqData.fundId,
      type: "contribution",
      amount: reqData.amountPence,
      fromUserId: reqData.childId,
      createdAt: serverTimestamp()
    });

    console.log('[petbox-approve] writing to wallet_transactions:', walletTxRef.path, {
      type: 'petbox_donation',
      childId: reqData.childId,
      amountPence: -reqData.amountPence,
      amount: -reqData.amountPence,
      note: `Donated to ${reqData.fundName}`
    });
    transaction.set(walletTxRef, {
      type: 'petbox_donation',
      childId: reqData.childId,
      amountPence: -reqData.amountPence,
      amount: -reqData.amountPence,
      note: `Donated to ${reqData.fundName}`,
      createdAt: serverTimestamp(),
      timestamp: serverTimestamp()
    });

    console.log('[petbox-approve] writing to petbox_requests:', reqRef.path, {
      status: 'approved',
      reviewedBy: currentUserUid
    });
    transaction.update(reqRef, {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUserUid,
      approvalTxId,
      fundTransactionId: txRef.id,
    });

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Pet Box donation approved.`,
      visibleTo: [reqData.childId, currentUserUid],
      timestamp: serverTimestamp()
    });
  });
};

export const rejectPetBoxDonation = async (familyId: string, requestId: string) => {
  const reqRef = doc(db, `families/${familyId}/petbox_requests`, requestId);
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");

  await runTransaction(db, async (transaction) => {
    const reqDoc = await transaction.get(reqRef);
    if (!reqDoc.exists()) throw new Error("Request not found");
    if (reqDoc.data().status !== 'pending') throw new Error('Request is not pending approval');

    transaction.update(reqRef, {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUserUid
    });

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Pet Box donation rejected.`,
      visibleTo: [reqDoc.data().childId, currentUserUid],
      timestamp: serverTimestamp()
    });
  });
};

// ---------------------------
// 9. CHILD-TO-CHILD TRANSFERS
// ---------------------------

export const createTransferRequest = async (familyId: string, toChildId: string, amountPence: number, message: string) => {
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");

  const reqRef = doc(collection(db, `families/${familyId}/transfer_requests`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const fromUserRef = doc(db, 'users', currentUserUid);
  const toUserRef = doc(db, 'users', toChildId);

  await runTransaction(db, async (transaction) => {
    const [fromDoc, toDoc] = await Promise.all([
      transaction.get(fromUserRef),
      transaction.get(toUserRef)
    ]);

    if (!fromDoc.exists() || !toDoc.exists()) throw new Error("User does not exist");
    const fromData = fromDoc.data();
    const toData = toDoc.data();

    if (fromData.role !== 'child' || toData.role !== 'child') throw new Error("Both participants must be children");
    if (fromData.familyId !== familyId || toData.familyId !== familyId) throw new Error("Both participants must be in the same family");
    if (currentUserUid === toChildId) throw new Error("Sender and recipient must differ");
    if (!Number.isInteger(amountPence) || amountPence <= 0) throw new Error("Invalid amount");

    transaction.set(reqRef, {
      id: reqRef.id,
      familyId,
      fromChildId: currentUserUid,
      fromChildName: fromData.displayName,
      toChildId,
      toChildName: toData.displayName,
      amountPence,
      message,
      status: 'pending',
      createdAt: serverTimestamp()
    });

    transaction.set(feedRef, {
      actorId: currentUserUid,
      actorName: fromData.displayName,
      type: 'custom',
      text: `${fromData.displayName} requested to send £${(amountPence / 100).toFixed(2)} to ${toData.displayName}.`,
      visibleTo: [currentUserUid, toChildId],
      timestamp: serverTimestamp()
    });
  });
};

export const approveTransferRequest = async (familyId: string, requestId: string) => {
  const reqRef = doc(db, `families/${familyId}/transfer_requests`, requestId);
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const approvalTxId = doc(collection(db, `families/${familyId}/wallet_transactions`)).id;
  const txOutRef = doc(db, `families/${familyId}/wallet_transactions`, `${approvalTxId}_out`);
  const txInRef = doc(db, `families/${familyId}/wallet_transactions`, `${approvalTxId}_in`);
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");
  const currentUserRef = doc(db, 'users', currentUserUid);

  await runTransaction(db, async (transaction) => {
    console.log('[transfer-approve] step: request read');
    const reqDoc = await transaction.get(reqRef);
    if (!reqDoc.exists()) throw new Error("Request not found");

    const requestData = reqDoc.data();
    if (requestData.status !== 'pending') throw new Error("Request is not pending");
    if (!Number.isInteger(requestData.amountPence) || requestData.amountPence <= 0) throw new Error("Invalid amount");
    if (requestData.fromChildId === requestData.toChildId) throw new Error("Sender and recipient must differ");

    const senderRef = doc(db, 'users', requestData.fromChildId);
    const recipientRef = doc(db, 'users', requestData.toChildId);

    console.log('[transfer-approve] step: reviewer/sender/recipient read');
    const [userDoc, senderDoc, recipientDoc] = await Promise.all([
      transaction.get(currentUserRef),
      transaction.get(senderRef),
      transaction.get(recipientRef)
    ]);

    if (!userDoc.exists()) throw new Error("Reviewer not found");
    const userData = userDoc.data();
    if (userData.familyId !== familyId) throw new Error("Reviewer not in family");
    if (userData.role !== 'parent' && userData.role !== 'owner') throw new Error("Reviewer is not parent/owner");

    if (!senderDoc.exists()) throw new Error("Sender not found");
    if (!recipientDoc.exists()) throw new Error("Recipient not found");
    const senderData = senderDoc.data();
    const recipientData = recipientDoc.data();
    if (senderData.role !== 'child' || recipientData.role !== 'child') throw new Error("Both participants must be children");
    if (senderData.familyId !== familyId || recipientData.familyId !== familyId) throw new Error("Both participants must be in the same family");

    const fromWalletRef = doc(db, `families/${familyId}/wallets`, requestData.fromChildId);
    const toWalletRef = doc(db, `families/${familyId}/wallets`, requestData.toChildId);

    console.log('[transfer-approve] step: sender wallet read/ensure');
    const fromBalance = await ensureWalletDocument(transaction, familyId, requestData.fromChildId, senderDoc);
    console.log('[transfer-approve] step: recipient wallet read/ensure');
    const toBalance = await ensureWalletDocument(transaction, familyId, requestData.toChildId, recipientDoc);

    if (fromBalance < requestData.amountPence) {
      throw new Error("Sender no longer has sufficient funds.");
    }

    console.log('[transfer-approve] step: sender wallet write');
    transaction.set(fromWalletRef, {
      balance: fromBalance - requestData.amountPence,
      lastTransferTxId: txOutRef.id,
      lastTransferReqId: requestId
    }, { merge: true });

    console.log('[transfer-approve] step: recipient wallet write');
    transaction.set(toWalletRef, {
      balance: toBalance + requestData.amountPence,
      lastTransferTxId: txInRef.id,
      lastTransferReqId: requestId
    }, { merge: true });

    console.log('[transfer-approve] step: request approved write');
    transaction.update(reqRef, transferApprovalRequestUpdate(approvalTxId, currentUserUid, userData.displayName || 'Parent', serverTimestamp()));

    const commonTxData = {
      amountPence: requestData.amountPence,
      transferRequestId: requestId,
      approvalTxId: approvalTxId,
      createdAt: serverTimestamp(),
      parentRef: currentUserUid,
      note: requestData.message || ""
    };

    console.log('[transfer-approve] step: transfer_out write');
    transaction.set(txOutRef, {
      ...commonTxData,
      type: 'transfer_out',
      childId: requestData.fromChildId,
      counterpartyChildId: requestData.toChildId,
      amountPence: -requestData.amountPence
    });

    console.log('[transfer-approve] step: transfer_in write');
    transaction.set(txInRef, {
      ...commonTxData,
      type: 'transfer_in',
      childId: requestData.toChildId,
      counterpartyChildId: requestData.fromChildId,
      amountPence: requestData.amountPence
    });

    console.log('[transfer-approve] step: feed write');
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `${requestData.fromChildName} sent £${(requestData.amountPence / 100).toFixed(2)} to ${requestData.toChildName}.`,
      visibleTo: [requestData.fromChildId, requestData.toChildId],
      timestamp: serverTimestamp()
    });
  });
};

export const rejectTransferRequest = async (familyId: string, requestId: string) => {
  const reqRef = doc(db, `families/${familyId}/transfer_requests`, requestId);
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");
  const currentUserRef = doc(db, 'users', currentUserUid);

  await runTransaction(db, async (transaction) => {
    const [reqDoc, userDoc] = await Promise.all([
      transaction.get(reqRef),
      transaction.get(currentUserRef)
    ]);
    if (!reqDoc.exists() || reqDoc.data().status !== 'pending') throw new Error("Request not valid");
    if (!userDoc.exists()) throw new Error("Reviewer not found");
    const userData = userDoc.data();
    if (userData.familyId !== familyId) throw new Error("Reviewer not in family");
    if (userData.role !== 'parent' && userData.role !== 'owner') throw new Error("Reviewer is not parent/owner");

    transaction.update(reqRef, {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUserUid,
      reviewedByName: userData.displayName
    });

    transaction.set(feedRef, {
      actorId: currentUserUid,
      actorName: userData.displayName,
      type: 'custom',
      text: `Transfer request from ${reqDoc.data().fromChildName} to ${reqDoc.data().toChildName} was rejected.`,
      visibleTo: [reqDoc.data().fromChildId, reqDoc.data().toChildId],
      timestamp: serverTimestamp()
    });
  });
};
export const createMoneyRequest = async (familyId: string, requestedFromId: string, amountPence: number, message: string) => {
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");

  const reqRef = doc(collection(db, `families/${familyId}/money_requests`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const fromUserRef = doc(db, 'users', currentUserUid);
  const toUserRef = doc(db, 'users', requestedFromId);

  await runTransaction(db, async (transaction) => {
    const [fromDoc, toDoc] = await Promise.all([
      transaction.get(fromUserRef),
      transaction.get(toUserRef)
    ]);

    if (!fromDoc.exists() || !toDoc.exists()) throw new Error("User does not exist");
    const fromData = fromDoc.data();
    const toData = toDoc.data();

    if (fromData.familyId !== familyId || toData.familyId !== familyId) throw new Error("Both participants must be in the same family");
    if (amountPence <= 0 || !Number.isInteger(amountPence)) throw new Error("Invalid amount");
    if (fromDoc.id === toDoc.id) throw new Error("Cannot request from self");
    const initialStatus = toData.role === 'parent' ? 'pending' : 'pending_acceptance';

    transaction.set(reqRef, {
      familyId,
      requesterId: currentUserUid,
      requesterName: fromData.displayName,
      requestedFromId,
      requestedFromName: toData.displayName,
      amountPence,
      message,
      status: initialStatus,
      createdAt: serverTimestamp()
    });

    transaction.set(feedRef, {
      actorId: currentUserUid,
      text: `${fromData.displayName} requested £${(amountPence / 100).toFixed(2)} from ${toData.displayName}.`,
      visibleTo: [currentUserUid, requestedFromId],
      timestamp: serverTimestamp()
    });
  });
};

export const acceptMoneyRequest = async (familyId: string, requestId: string) => {
  const reqRef = doc(db, `families/${familyId}/money_requests`, requestId);
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");

  await runTransaction(db, async (transaction) => {
    const reqDoc = await transaction.get(reqRef);
    if (!reqDoc.exists()) throw new Error("Request not found");
    const reqData = reqDoc.data();

    if (reqData.requestedFromId !== currentUserUid) throw new Error("Unauthorized");
    if (reqData.status !== 'pending_acceptance') throw new Error("Request cannot be accepted");

    transaction.update(reqRef, {
      status: 'pending' // Now waiting for parent approval
    });

    transaction.set(feedRef, {
      actorId: currentUserUid,
      text: `${reqData.requestedFromName} accepted ${reqData.requesterName}'s request for £${(reqData.amountPence / 100).toFixed(2)}. Awaiting parent approval.`,
      visibleTo: [currentUserUid, reqData.requesterId],
      timestamp: serverTimestamp()
    });
  });
};

export const declineMoneyRequest = async (familyId: string, requestId: string) => {
  const reqRef = doc(db, `families/${familyId}/money_requests`, requestId);
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");

  await runTransaction(db, async (transaction) => {
    const reqDoc = await transaction.get(reqRef);
    if (!reqDoc.exists()) throw new Error("Request not found");
    const reqData = reqDoc.data();

    if (reqData.requestedFromId !== currentUserUid) throw new Error("Unauthorized");
    if (reqData.status !== 'pending_acceptance') throw new Error("Request cannot be declined");

    transaction.update(reqRef, {
      status: 'rejected',
      reviewedAt: serverTimestamp()
    });

    transaction.set(feedRef, {
      actorId: currentUserUid,
      text: `${reqData.requestedFromName} declined ${reqData.requesterName}'s request.`,
      visibleTo: [currentUserUid, reqData.requesterId],
      timestamp: serverTimestamp()
    });
  });
};

export const approveMoneyRequest = async (familyId: string, requestId: string) => {
  const reqRef = doc(db, `families/${familyId}/money_requests`, requestId);
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");
  const currentUserRef = doc(db, 'users', currentUserUid);

  const approvalTxId = doc(collection(db, `families/${familyId}/wallet_transactions`)).id;
  const txOutRef = doc(db, `families/${familyId}/wallet_transactions`, `${approvalTxId}_out`);
  const txInRef = doc(db, `families/${familyId}/wallet_transactions`, `${approvalTxId}_in`);

  await runTransaction(db, async (transaction) => {
    const [reqDoc, userDoc] = await Promise.all([
      transaction.get(reqRef),
      transaction.get(currentUserRef)
    ]);
    if (!reqDoc.exists()) throw new Error("Request not found");
    const reqData = reqDoc.data();
    const userData = userDoc.data();

    if (!userDoc.exists() || userData?.familyId !== familyId) throw new Error('Reviewer not in family');
    if (userData?.role !== 'parent' && userData?.role !== 'owner') throw new Error("Unauthorized");
    if (reqData.status !== 'pending') throw new Error("Request is not pending approval");

    const requesterWalletRef = doc(db, `families/${familyId}/wallets`, reqData.requesterId);

    // If request was to parent
    const requestedFromRef = doc(db, 'users', reqData.requestedFromId);
    const requestedFromDoc = await transaction.get(requestedFromRef);
    const isFromParent = requestedFromDoc.data()?.role === 'parent' || requestedFromDoc.data()?.role === 'owner';

    const requesterUserRef = doc(db, 'users', reqData.requesterId);
    const requesterUserDoc = await transaction.get(requesterUserRef);
    if (!requesterUserDoc.exists()) throw new Error("User not found");
    const reqBalance = await ensureWalletDocument(transaction, familyId, reqData.requesterId, requesterUserDoc);

    if (isFromParent) {
      transaction.set(requesterWalletRef, {
        balance: reqBalance + reqData.amountPence,
        lastTransferTxId: txInRef.id,
        lastTransferReqId: requestId,
      }, { merge: true });

      transaction.set(txInRef, {
        type: 'request_payment',
        childId: reqData.requesterId,
        amount: reqData.amountPence,
        amountPence: reqData.amountPence,
        moneyRequestId: requestId,
        approvalTxId,
        note: reqData.message || 'Money Requested',
        parentRef: currentUserUid,
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp()
      });
    } else {
      const fromWalletRef = doc(db, `families/${familyId}/wallets`, reqData.requestedFromId);
      if (!requestedFromDoc.exists()) throw new Error("User not found");
      const fromBalance = await ensureWalletDocument(transaction, familyId, reqData.requestedFromId, requestedFromDoc);

      if (fromBalance < reqData.amountPence) throw new Error("Insufficient funds");

      transaction.set(fromWalletRef, {
        balance: fromBalance - reqData.amountPence,
        lastTransferTxId: txOutRef.id,
        lastTransferReqId: requestId,
      }, { merge: true });

      transaction.set(requesterWalletRef, {
        balance: reqBalance + reqData.amountPence,
        lastTransferTxId: txInRef.id,
        lastTransferReqId: requestId,
      }, { merge: true });

      const commonTxData = {
        amountPence: reqData.amountPence,
        moneyRequestId: requestId,
        approvalTxId: approvalTxId,
        createdAt: serverTimestamp(),
        timestamp: serverTimestamp(),
        parentRef: currentUserUid,
        note: reqData.message || ""
      };

      transaction.set(txOutRef, {
        ...commonTxData,
        type: 'transfer_out',
        childId: reqData.requestedFromId,
        counterpartyChildId: reqData.requesterId,
        amountPence: -reqData.amountPence
      });

      transaction.set(txInRef, {
        ...commonTxData,
        type: 'transfer_in',
        childId: reqData.requesterId,
        counterpartyChildId: reqData.requestedFromId,
        amountPence: reqData.amountPence
      });
    }

    transaction.update(reqRef, {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUserUid,
      reviewedByName: userData?.displayName || 'Parent',
      paymentTransferId: approvalTxId
    });

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Money request approved.`,
      visibleTo: [reqData.requesterId, reqData.requestedFromId],
      timestamp: serverTimestamp()
    });
  });
};

export const rejectMoneyRequest = async (familyId: string, requestId: string) => {
  const reqRef = doc(db, `families/${familyId}/money_requests`, requestId);
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");
  const currentUserRef = doc(db, 'users', currentUserUid);

  await runTransaction(db, async (transaction) => {
    const [reqDoc, userDoc] = await Promise.all([
      transaction.get(reqRef),
      transaction.get(currentUserRef)
    ]);
    if (!reqDoc.exists()) throw new Error("Request not found");
    const userData = userDoc.data();

    if (!userDoc.exists() || userData?.familyId !== familyId || (userData?.role !== 'parent' && userData?.role !== 'owner')) throw new Error("Unauthorized");
    if (reqDoc.data().status !== 'pending') throw new Error('Request is not pending approval');

    transaction.update(reqRef, {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUserUid,
      reviewedByName: userData?.displayName || 'Parent'
    });

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Money request rejected.`,
      visibleTo: [reqDoc.data().requesterId, reqDoc.data().requestedFromId],
      timestamp: serverTimestamp()
    });
  });
};

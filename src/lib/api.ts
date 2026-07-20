import {
  collection, doc, setDoc, updateDoc,
  addDoc, runTransaction, query, where, orderBy, getDocs, getDoc, serverTimestamp, deleteDoc, writeBatch
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail
} from 'firebase/auth';
import { db, auth, googleProvider } from './firebase';
import { FAMILYQUEST_BUILD } from '../buildInfo';
import { calculateBehaviourEffect, DEFAULT_DEBT_LIMIT_PENCE } from './behaviour';
import type { BehaviourEventInput } from './behaviour';
import { reviewerFields, transferApprovalRequestUpdate } from './approvalContracts';
import { effectSnapshot, manualWalletEffectSnapshot } from './reversalContracts';
import {
  loadNotificationRecipientsInTransaction,
  applyNotificationWrites,
  getApproverIds,
  getChildIds,
} from './notifications';
import {
  taskSubmittedKey,
  taskApprovedKey,
  taskRejectedKey,
  rewardRequestedKey,
  behaviourKey,
  walletDepositKey,
  walletWithdrawalKey,
  petboxContributionKey,
  petboxExpenseKey,
  transferRequestedKey,
  transferApprovedSenderKey,
  transferApprovedRecipientKey,
  transferRejectedKey,
  profileUpdateRequestedKey,
  profileUpdateApprovedKey,
  profileUpdateRejectedKey,
} from './notificationDedupe';
import { useStore } from '../store/useStore';
import { unregisterCurrentDevice } from './pushNotifications';
import { getAvatarById, getAvatarCost, resolveAvatarImage } from '../config/avatarCatalog';
import {
  periodKeyFor,
} from './taskRecurrence';
import {
  computeNetChild,
  computeMatchPence,
  normalizeGoalDoc,
  requestHashOf,
  goalContributionKey,
  goalWithdrawalKey,
  goalMatchKey,
  type Goal,
  type GoalKind,
  type GoalStatus,
  type MatchingPolicy,
  type ContributionLeg,
  type MatchProposal,
  type ParentContributionInput,
  validateParentContribution,
} from './goalContracts';

// ---------------------------
// 0. AUTHENTICATION
// ---------------------------

// Strict authenticated-user guard. Returns the caller UID or fails clearly
// BEFORE any write is attempted. Never returns undefined.
function requireActorId(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authentication required');
  return uid;
}

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

export const signOut = async () => {
  // Best-effort: stop the current device from receiving future pushes.
  // Never blocks sign-out if push cleanup fails.
  try {
    const state = useStore.getState();
    const user = state.currentUser;
    const familyId = state.familyData?.id ?? user?.familyId;
    if (user?.id && familyId) {
      await unregisterCurrentDevice(familyId, user.id);
    }
  } catch {
    // ignore — sign-out must always proceed
  }
  return firebaseSignOut(auth);
};

// ---------------------------
// 0.1 ACCOUNT SECURITY HELPERS
// ---------------------------

export interface AuthProviderInfo {
  /** True when the account has an email/password credential and can use password reset. */
  isEmailPassword: boolean;
  /** True when the account authenticates via a federated provider (Google, etc.). */
  isOAuth: boolean;
  /** Raw Firebase provider ids attached to the current user. */
  providers: string[];
  /** Human-readable primary provider label, e.g. "Google". */
  primaryProviderLabel: string | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  'google.com': 'Google',
  'facebook.com': 'Facebook',
  'github.com': 'GitHub',
  'apple.com': 'Apple',
  'twitter.com': 'Twitter',
  'microsoft.com': 'Microsoft',
  password: 'Email & Password',
};

/**
 * Inspects the signed-in user's auth providers so the UI can decide which
 * security actions are genuinely supported (password reset vs. OAuth message).
 */
export function getAuthProviderInfo(): AuthProviderInfo {
  const providers = (auth.currentUser?.providerData ?? []).map(p => p.providerId);
  const isEmailPassword = providers.includes('password');
  const isOAuth = providers.some(p => p !== 'password');
  const primaryProviderLabel =
    providers.map(p => PROVIDER_LABELS[p] ?? p).find(Boolean) ?? null;
  return { isEmailPassword, isOAuth, providers, primaryProviderLabel };
}

/**
 * Sends a Firebase password-reset email. Preferred over in-app password update
 * because the app does not yet implement reauthentication.
 */
export const sendPasswordReset = async (email: string): Promise<void> => {
  await firebaseSendPasswordResetEmail(auth, email);
};

/**
 * Maps raw Firebase Auth errors to friendly, non-technical messages.
 * Never surfaces raw error codes or server messages to the user.
 */
export function mapAuthErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address does not look valid. Please check and try again.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'We could not find an account with those details.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'A network error occurred. Please check your connection and try again.';
    case 'auth/requires-recent-login':
      return 'For security, please sign out and sign back in before doing this.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled. Please contact support.';
    case 'auth/missing-continue-uri':
    case 'auth/invalid-continue-uri':
      return 'We could not complete that request. Please try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

// ---------------------------
// 1. FAMILIES & USERS
// ---------------------------

export const createFamilyAndParent = async (_uid: string, _name: string, familyName: string) => {
  const familyRef = doc(collection(db, 'families'));
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  await runTransaction(db, async (transaction) => {
    transaction.set(familyRef, {
      name: familyName,
      inviteCode,
      createdAt: serverTimestamp()
    });

    // NOTE: The owner (parent) user doc is already created by signUp()/signInWithGoogle()
    // with role 'parent' and NO familyId. Re-writing it here with merge:true would be an
    // UPDATE (the doc already exists), which the users update rule denies because it touches
    // protected fields (role, rewardPoints, ...). That denial produced the
    // "Missing or insufficient permissions" error on Step 1. The owner has no wallet doc
    // (only children do), so the only write needed is the family doc itself.
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

export const approveJoinRequest = async (familyId: string, requestId: string, role: 'parent' | 'child') => {
  const reviewerUid = auth.currentUser?.uid;
  if (!reviewerUid) throw new Error('Not authenticated');
  await runTransaction(db, async (transaction) => {
    const requestRef = doc(db, `families/${familyId}/join_requests`, requestId);
    const reviewerRef = doc(db, 'users', reviewerUid);
    const [requestDoc, reviewerDoc] = await Promise.all([transaction.get(requestRef), transaction.get(reviewerRef)]);
    if (!requestDoc.exists() || requestDoc.data().status !== 'pending') throw new Error('Join request is not pending');
    if (!reviewerDoc.exists() || reviewerDoc.data().familyId !== familyId || reviewerDoc.data().role !== 'owner') throw new Error('Only the family owner can review join requests');
    const uid = requestDoc.data().uid;
    const displayName = requestDoc.data().displayName;
    if (typeof uid !== 'string' || typeof displayName !== 'string' || !displayName.trim()) throw new Error('Join request identity is invalid');
    const userRef = doc(db, 'users', uid);

    if (role === 'child') {
      transaction.set(doc(db, `families/${familyId}/wallets`, uid), {
        balance: 0, createdAt: serverTimestamp(), migratedFromLegacy: true,
      }, { merge: true });
    }
    transaction.set(userRef, {
      uid,
      joinRequestId: requestId,
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
    transaction.set(doc(db, `families/${familyId}/feed`, `join_${requestId}`), {
      actorId: reviewerUid, type: 'custom',
      text: `${displayName} has joined the family as a ${role}!`, timestamp: serverTimestamp(),
    });
  });
};

export const rejectJoinRequest = async (familyId: string, uid: string, rejectionReason: string) => {
  if (!rejectionReason.trim()) throw new Error('Rejection reason is required');
  const reviewerUid = auth.currentUser?.uid;
  if (!reviewerUid) throw new Error('Not authenticated');
  await runTransaction(db, async transaction => {
    const requestRef = doc(db, `families/${familyId}/join_requests`, uid);
    const reviewerRef = doc(db, 'users', reviewerUid);
    const [requestDoc, reviewerDoc] = await Promise.all([transaction.get(requestRef), transaction.get(reviewerRef)]);
    if (!requestDoc.exists() || requestDoc.data().status !== 'pending') throw new Error('Join request is not pending');
    if (!reviewerDoc.exists() || reviewerDoc.data().familyId !== familyId || reviewerDoc.data().role !== 'owner') throw new Error('Only the family owner can review join requests');
    transaction.update(requestRef, {
      status: 'rejected', rejectionReason: rejectionReason.trim(),
      ...reviewerFields(reviewerUid, reviewerDoc.data().displayName || 'Owner', serverTimestamp()),
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

export interface CreateManagedMemberProfile {
  /** Optional ISO date-of-birth string (YYYY-MM-DD). */
  dob?: string | null;
  /** Optional curated catalog avatar id (starter only for managed children). */
  avatarId?: string | null;
  /** Optional profile accent colour (hex string). */
  colour?: string | null;
}

/**
 * Creates a managed family member (child or parent). The optional `profile`
 * carries the extra onboarding fields (date of birth, avatar, colour) without
 * changing the core contract used elsewhere (e.g. the family-creation flow).
 * Existing callers that omit `profile` are unaffected.
 */
export const createManagedMember = async (
  familyId: string,
  role: 'parent' | 'child',
  displayName: string,
  profile?: CreateManagedMemberProfile,
) => {
  const userRef = doc(collection(db, 'users'));
  const defaultAvatarUrl = `https://api.dicebear.com/7.x/${role === 'parent' ? 'avataaars' : 'bottts'}/svg?seed=${displayName}`;

  const memberDoc: Record<string, unknown> = {
    uid: userRef.id,
    familyId,
    role,
    displayName,
    isManaged: true,
    avatarUrl: defaultAvatarUrl,
    rewardPoints: 0,
    lifetimeXP: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: serverTimestamp(),
  };

  // Apply optional onboarding profile fields. Avatar resolution always goes
  // through the curated catalog so a managed child can never store an arbitrary
  // external URL.
  if (profile?.avatarId) {
    memberDoc.avatarId = profile.avatarId;
    memberDoc.avatarUrl = resolveAvatarImage(profile.avatarId, defaultAvatarUrl) || defaultAvatarUrl;
  }
  if (profile?.dob) memberDoc.dob = profile.dob;
  if (profile?.colour) memberDoc.colour = profile.colour;

  const batch = writeBatch(db);
  batch.set(doc(db, `families/${familyId}/wallets`, userRef.id), {
    balance: 0,
    createdAt: serverTimestamp(),
    migratedFromLegacy: true,
  });
  batch.set(userRef, memberDoc);
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

// ---------------------------
// 2. TASKS & COMPLETIONS
// ---------------------------

export const createTask = async (familyId: string, taskData: any) => {
  const actorId = requireActorId();
  const taskRef = doc(collection(db, `families/${familyId}/tasks`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const batch = writeBatch(db);
  batch.set(taskRef, {
    ...taskData,
    isActive: true,
    createdAt: serverTimestamp()
  });
  batch.set(feedRef, {
    actorId,
    text: `New task added: ${taskData.title}`,
    timestamp: serverTimestamp()
  });
  console.log('[createTask]', {
    buildId: FAMILYQUEST_BUILD.sha,
    actorId,
    taskPath: `families/${familyId}/tasks`,
    feedPath: `families/${familyId}/feed`,
    mode: 'writeBatch'
  });
  try {
    await batch.commit();
    console.log('[createTask] batch commit success');
  } catch (error) {
    console.error('[createTask] batch commit failed', error);
    throw error;
  }
  return taskRef;
};

export const completeTask = async (familyId: string, taskId: string, userId: string, requiresApproval: boolean) => {
  const actorId = auth.currentUser?.uid;
  if (!actorId) throw new Error('Not authenticated');
  if (actorId !== userId) throw new Error('Cannot complete a task for another user');
  const approverIds = await getApproverIds(familyId);
  await runTransaction(db, async (transaction) => {
    // ---------------------------------------------------------------------
    // PHASE A — ALL READS (no writes may occur before this phase completes)
    // ---------------------------------------------------------------------
    const userRef = doc(db, 'users', userId);
    const completionRef = doc(collection(db, `families/${familyId}/task_completions`));
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error("User not found");

    // READ task (needed for auto-award and for the approval notification body)
    const taskRef = doc(db, `families/${familyId}/tasks`, taskId);
    const taskSnap = await transaction.get(taskRef);

    const userData = userDoc.data();

    // Recurrence period key: a recurring task is "done" only within its current
    // period. We store this on the immutable completion record and use it (with
    // the task schedule type) to derive availability without mutating history.
    const taskType = taskSnap.exists() ? (taskSnap.data().type as string | undefined) : undefined;
    const currentPeriodKey = periodKeyFor(taskType, new Date());

    // Server-side guard: do not create a second completion / award points again
    // for the same task+assignee within the current period. This keeps the
    // recurrence reset authoritative on the server, not just the client UI.
    // Queries a single field (periodKey) so no composite index is required; the
    // task/assignee match is resolved in memory.
    const completionsQuery = query(
      collection(db, `families/${familyId}/task_completions`),
      where('periodKey', '==', currentPeriodKey),
    );
    if (completionsQuery) {
      // `Transaction.get` is typed for DocumentReference in this SDK surface; a
      // Query is accepted at runtime, so we pass it through unchanged.
      const existingSnap = await transaction.get(completionsQuery as any);
      const existingDocs = (existingSnap as { docs?: any[] }).docs ?? [];
      const alreadyDoneThisPeriod = existingDocs.some((d: any) => {
        const data = typeof d.data === 'function' ? d.data() : d;
        return (
          data.taskId === taskId &&
          data.assigneeId === userId &&
          (data.status === 'approved' || data.status === 'pending_approval')
        );
      });
      if (alreadyDoneThisPeriod) {
        // Idempotent no-op for this period: the task is already completed/submitted.
        return;
      }
    }

    // Resolve the notification dedupe read up-front so the write phase never
    // performs a transaction.get (Firestore requires reads-before-writes).
    let notifPlan = { ref: null, data: null } as Awaited<
      ReturnType<typeof loadNotificationRecipientsInTransaction>
    >;
    if (requiresApproval && approverIds.length > 0) {
      notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
        type: 'task_submitted',
        actorId: userId,
        recipientIds: approverIds,
        title: `${userData.displayName || 'A child'} completed a task`,
        body: `Review “${taskSnap.exists() ? taskSnap.data().title : ''}”`,
        entityType: 'task_completion',
        entityId: completionRef.id,
        actionUrl: '/',
        dedupeKey: taskSubmittedKey(completionRef.id),
      });
    }

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
    const status = requiresApproval ? 'pending_approval' : 'approved';
    transaction.set(completionRef, {
      taskId,
      assigneeId: userId,
      status,
      periodKey: currentPeriodKey,
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

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
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

    // Resolve the notification dedupe read up-front (reads-before-writes).
    const notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
      type: 'task_approved',
      actorId: currentUserUid,
      recipientIds: [completion.assigneeId],
      title: 'Task approved',
      body: `“${taskDoc.data().title}” was approved. +${points} points`,
      entityType: 'task_completion',
      entityId: completionId,
      actionUrl: '/tasks',
      dedupeKey: taskApprovedKey(completionId),
    });

    transaction.update(completionRef, {
      status: 'approved',
      parentComment: comment || null,
      approvedAt: serverTimestamp(),
      awardedPoints: points,
      effectSnapshot: effectSnapshot({ entityType: 'task_completion', familyId, actorId: currentUserUid, childId: completion.assigneeId, pointsDelta: points }),
      ...reviewerFields(currentUserUid, reviewerDoc.data().displayName || 'Parent', serverTimestamp()),
    });

    const currentPoints = userDoc.data().rewardPoints || 0;
    const currentXP = userDoc.data().lifetimeXP || 0;
    transaction.update(userRef, {
      rewardPoints: currentPoints + points,
      lifetimeXP: currentXP + points,
      lastTaskCompletionId: completionId,
    });

    const feedRef = doc(db, `families/${familyId}/feed`, `task_approval_${completionId}`);
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Task approved: ${taskDoc.data().title} (+${points} pts)${comment ? ` - "${comment}"` : ''}`,
      timestamp: serverTimestamp()
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
  });
};

export const rejectTaskCompletion = async (familyId: string, completionId: string, comment: string) => {
  if (!comment.trim()) throw new Error('Rejection reason is required');
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

    // Resolve the notification dedupe read up-front (reads-before-writes).
    const notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
      type: 'task_rejected',
      actorId: currentUserUid,
      recipientIds: [completion.assigneeId],
      title: 'Task needs attention',
      body: `“${taskDoc.data().title}” needs attention: “${comment}”`,
      entityType: 'task_completion',
      entityId: completionId,
      actionUrl: '/tasks',
      dedupeKey: taskRejectedKey(completionId),
    });

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

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
  });
};

// ---------------------------
// 3. BEHAVIOUR EVENTS
// ---------------------------

export async function addBehaviourEvent(
  familyId: string,
  childId: string,
  _createdBy: string,
  input: BehaviourEventInput,
): Promise<string> {
  const actorId = auth.currentUser?.uid;
  if (!actorId) throw new Error('Not authenticated');
  const familyRef = doc(db, 'families', familyId);
  const childRef = doc(db, 'users', childId);
  const creatorRef = doc(db, 'users', actorId);
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

    // Resolve the notification dedupe read up-front (reads-before-writes).
    const notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
      type: input.type === 'positive' ? 'behaviour_positive' : 'behaviour_negative',
      actorId,
      recipientIds: [childId],
      title: input.type === 'positive' ? 'Positive behaviour' : (input.type === 'financial' ? 'Behaviour noted' : 'Behaviour needs attention'),
      body: input.reason.trim(),
      entityType: 'behaviour_event',
      entityId: eventRef.id,
      actionUrl: `/family/${childId}`,
      dedupeKey: behaviourKey(eventRef.id),
    });

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
      transaction.update(childRef, { rewardPoints: effect.rewardPoints, lifetimeXP: effect.lifetimeXP, lastBehaviourEventId: eventRef.id });
    } else if (input.type === 'negative') {
      transaction.update(childRef, { rewardPoints: effect.rewardPoints, lastBehaviourEventId: eventRef.id });
    } else {
      transaction.update(walletRef, { balance: effect.walletBalance, lastPenaltyTxId: ledgerRef!.id });
    }

    transaction.set(eventRef, {
      familyId,
      childId,
      type: input.type,
      reason: input.reason.trim(),
      pointsDelta: effect.pointsDelta,
      walletDelta: effect.walletDelta,
      createdBy: actorId,
      createdByName: creator.displayName,
      createdAt: serverTimestamp(),
      effectSnapshot: effectSnapshot({ entityType: 'behaviour_event', familyId, actorId, childId, pointsDelta: effect.pointsDelta, walletDeltaPence: effect.walletDelta }),
    });

    if (ledgerRef) {
      transaction.set(ledgerRef, {
        type: 'financial_penalty',
        eventId: eventRef.id,
        sourceId: eventRef.id,
        familyId,
        status: 'completed',
        childId,
        amount: -effect.walletDelta,
        reason: input.reason.trim(),
        createdBy: actorId,
        createdByName: creator.displayName,
        createdAt: serverTimestamp(),
        effectSnapshot: effectSnapshot({ entityType: 'behaviour_event', familyId, actorId, childId, walletDeltaPence: effect.walletDelta }),
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
      actorId,
      text: `Logged behaviour for ${child.displayName}: ${input.reason.trim()} (${deltaText})`,
      createdAt: feedTimestamp,
      timestamp: feedTimestamp,
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
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
  const actorId = requireActorId();
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
      actorId,
      text: `Family Challenge Completed: ${challengeTitle}! Everyone got +${rewardPoints} pts!`,
      timestamp: serverTimestamp()
    });
  });
};

// ---------------------------
// 5. REWARDS & REDEMPTIONS
// ---------------------------

export const redeemReward = async (familyId: string, userId: string, rewardId: string) => {
  const actorId = auth.currentUser?.uid;
  if (!actorId) throw new Error('Not authenticated');
  if (actorId !== userId) throw new Error('Cannot redeem a reward for another user');
  const rewardRef = doc(db, `families/${familyId}/rewards`, rewardId);
  const userRef = doc(db, 'users', userId);
  const redemptionRef = doc(collection(db, `families/${familyId}/redemptions`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const approverIds = await getApproverIds(familyId);

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

    // Resolve the notification dedupe read up-front (reads-before-writes).
    let notifPlan = { ref: null, data: null } as Awaited<
      ReturnType<typeof loadNotificationRecipientsInTransaction>
    >;
    if (approverIds.length > 0) {
      notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
        type: 'reward_requested',
        actorId: userId,
        recipientIds: approverIds,
        title: 'Reward approval needed',
        body: `${userDoc.data().displayName || 'A child'} requested “${rewardDoc.data().title}”`,
        entityType: 'redemption',
        entityId: redemptionRef.id,
        actionUrl: '/',
        dedupeKey: rewardRequestedKey(redemptionRef.id),
      });
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
      familyId,
      sourceId: redemptionRef.id,
      actorId: userId,
      effectSnapshot: effectSnapshot({ entityType: 'reward_redemption', familyId, actorId: userId, childId: userId, rewardId, pointsDelta: -cost }),
    });

    transaction.set(feedRef, {
      actorId: userId,
      text: `Redeemed reward: ${rewardDoc.data().title}`,
      timestamp: serverTimestamp()
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
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
  const actorId = requireActorId();
  const rewardRef = doc(collection(db, `families/${familyId}/rewards`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const batch = writeBatch(db);
  batch.set(rewardRef, {
    ...data,
    createdAt: serverTimestamp()
  });
  batch.set(feedRef, {
    actorId,
    text: `New reward added: ${data.title}`,
    timestamp: serverTimestamp()
  });
  console.log('[createReward]', {
    buildId: FAMILYQUEST_BUILD.sha,
    actorId,
    rewardPath: `families/${familyId}/rewards`,
    feedPath: `families/${familyId}/feed`,
    mode: 'writeBatch'
  });
  try {
    await batch.commit();
    console.log('[createReward] batch commit success');
  } catch (error) {
    console.error('[createReward] batch commit failed', error);
    throw error;
  }
  return rewardRef;
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

// Ensures a canonical wallet document exists for a child and returns its balance.
// NOTE: This no longer seeds from the legacy users.walletBalance profile field.
// One-off legacy seeding now lives in scripts/migrate-wallet-balances.ts. If a
// wallet is somehow missing at runtime (e.g. a deposit to a child without one),
// we provision a zero-balance document rather than reading the legacy profile.
export const ensureWalletDocument = async (
  transaction: any,
  familyId: string,
  childId: string,
  _userSnapshot?: any,
  walletSnapshot?: any
): Promise<number> => {
  const walletRef = doc(db, `families/${familyId}/wallets`, childId);
  const walletDoc = walletSnapshot ?? await transaction.get(walletRef);

  if (walletDoc.exists()) {
    return walletDoc.data().balance || 0;
  }

  transaction.set(walletRef, {
    balance: 0,
    createdAt: serverTimestamp(),
    migratedFromLegacy: false,
  });

  return 0;
};

export const depositToWallet = async (familyId: string, childId: string, _parentId: string, amount: number, note: string) => {
  const actorId = auth.currentUser?.uid;
  if (!actorId) throw new Error('Not authenticated');
  const childWalletRef = doc(db, `families/${familyId}/wallets`, childId);
  const txRef = doc(collection(db, `families/${familyId}/wallet_transactions`));

  await runTransaction(db, async (transaction) => {
    const userRef = doc(db, 'users', childId);
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error("User not found");
    const currentBalance = await ensureWalletDocument(transaction, familyId, childId, userDoc);

    // Resolve the notification dedupe read up-front (reads-before-writes).
    const notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
      type: 'wallet_deposit',
      actorId,
      recipientIds: [childId],
      title: 'Money added to your wallet',
      body: `£${(amount / 100).toFixed(2)} was added to your wallet${note ? `: ${note}` : ''}`,
      entityType: 'wallet_transaction',
      entityId: txRef.id,
      actionUrl: '/wallet',
      dedupeKey: walletDepositKey(txRef.id),
    });

    transaction.set(childWalletRef, { balance: currentBalance + amount, lastManualTxId: txRef.id }, { merge: true });

    transaction.set(txRef, {
      type: 'deposit',
      childId,
      amount,
      note,
      familyId,
      sourceId: txRef.id,
      status: 'completed',
      parentRef: actorId,
      effectSnapshot: manualWalletEffectSnapshot('deposit', familyId, childId, amount, actorId),
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp()
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
  });
};

export const withdrawFromWallet = async (familyId: string, childId: string, _parentId: string, amount: number, note: string) => {
  const actorId = auth.currentUser?.uid;
  if (!actorId) throw new Error('Not authenticated');
  const childWalletRef = doc(db, `families/${familyId}/wallets`, childId);
  const txRef = doc(collection(db, `families/${familyId}/wallet_transactions`));

  await runTransaction(db, async (transaction) => {
    const userRef = doc(db, 'users', childId);
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error("User not found");
    const currentBalance = await ensureWalletDocument(transaction, familyId, childId, userDoc);

    if (currentBalance < amount) throw new Error("Insufficient funds");

    // Resolve the notification dedupe read up-front (reads-before-writes).
    const notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
      type: 'wallet_withdrawal',
      actorId,
      recipientIds: [childId],
      title: 'Money taken from your wallet',
      body: `£${(amount / 100).toFixed(2)} was taken from your wallet${note ? `: ${note}` : ''}`,
      entityType: 'wallet_transaction',
      entityId: txRef.id,
      actionUrl: '/wallet',
      dedupeKey: walletWithdrawalKey(txRef.id),
    });

    transaction.set(childWalletRef, { balance: currentBalance - amount, lastManualTxId: txRef.id }, { merge: true });

    transaction.set(txRef, {
      type: 'withdrawal',
      childId,
      amount,
      note,
      familyId,
      sourceId: txRef.id,
      status: 'completed',
      parentRef: actorId,
      effectSnapshot: manualWalletEffectSnapshot('withdrawal', familyId, childId, amount, actorId),
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp()
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
  });
};

export const transferWalletFunds = async (familyId: string, fromChildId: string, toChildId: string, _parentId: string, amount: number, note: string) => {
  const actorId = auth.currentUser?.uid;
  if (!actorId) throw new Error('Not authenticated');
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
      familyId,
      sourceId: txRef.id,
      status: 'completed',
      parentRef: actorId,
      effectSnapshot: effectSnapshot({ entityType: 'wallet_transfer', familyId, actorId, childId: fromChildId, counterpartyChildId: toChildId, walletDeltaPence: -amount, counterpartyWalletDeltaPence: amount }),
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
// 8b. GOALS / FAMILY FUND (Phase 1)
// ---------------------------
//
// Reuses the existing `savings_goals` collection as `goals` (design §13). All
// money-moving operations run inside a single runTransaction with
// reads-before-writes and a zero-read write stage (convention from §5 / line
// ~418). Every money-moving op also writes an atomic idempotency operation
// document (design §14) in the SAME transaction: no `processing` state is ever
// persisted, a reused key with a different requestHash is rejected, and a failed
// transaction leaves no idempotency record behind.
//
// Ownership is derived ONLY from the goal-specific immutable `contributions`
// ledger (design §7). wallet_transactions is never used to derive ownership.
// Parent and match contributions never credit a child wallet.

const GOAL_COLLECTION = 'savings_goals'; // reused as `goals` (design §13)

/**
 * v1 safety limit for multi-child refunds (design §5.7 / Phase 1 hardening).
 *
 * A single Return Funds / Cancel operation refunds each distinct child owner
 * separately. This cap bounds the number of per-child refund legs that may be
 * produced by one operation. It is a defensive guard against pathological or
 * abusive goal documents (e.g. thousands of distinct child owners) that would
 * otherwise fan out into an unbounded number of writes within a single
 * transaction. The limit is validated in the READ phase, BEFORE any write is
 * attempted, so exceeding it fails with zero financial writes.
 */
export const MAX_CHILD_REFUNDS_PER_GOAL = 20;

function goalRef(familyId: string, goalId: string) {
  return doc(db, `families/${familyId}/${GOAL_COLLECTION}`, goalId);
}
function idempotencyRef(familyId: string, key: string) {
  return doc(db, `families/${familyId}/idempotency`, key);
}

/**
 * Atomic idempotency guard (design §14). Reads the idempotency doc in the
 * transaction's read phase.
 *
 * Resolution rules (fail-closed):
 *  - Missing operation document: proceed (return null).
 *  - completed + same requestHash: return the original resultRef (idempotent replay).
 *  - completed + different requestHash: reject (key conflict).
 *  - Any existing record with an unexpected, malformed, or non-completed status:
 *    fail closed. We NEVER treat an existing incomplete record as absent, because
 *    a record that is present but not `completed` is an ambiguous/unsafe state
 *    (e.g. a partial write, a future `processing` state, or a malformed doc) and
 *    must not be silently overwritten or re-run.
 */
function checkIdempotency(
  idemSnap: { exists: () => boolean; data: () => any },
  key: string,
  requestHash: string,
): string | null {
  if (!idemSnap.exists()) return null;
  const rec = idemSnap.data();
  // A record must be a well-formed object with a recognised status.
  if (!rec || typeof rec !== 'object' || typeof rec.status !== 'string') {
    throw new Error(`Idempotency record for key "${key}" is malformed; refusing to proceed`);
  }
  if (rec.status === 'completed') {
    if (rec.requestHash === requestHash) return rec.resultRef as string;
    throw new Error('Idempotency key conflict: a different request was already recorded under this key');
  }
  // Any non-completed / unexpected status fails closed.
  throw new Error(`Idempotency record for key "${key}" has unexpected status "${rec.status}"; refusing to proceed`);
}

function writeIdempotency(
  transaction: any,
  familyId: string,
  key: string,
  operationType: string,
  actorId: string,
  requestHash: string,
  resultRef: string,
  extra?: { goalId?: string; amountPence?: number; clientReqId?: string },
  ref?: any,
) {
  transaction.set(ref ?? idempotencyRef(familyId, key), {
    operationType,
    actorId,
    requestHash,
    status: 'completed',
    resultRef,
    ...(extra?.goalId != null ? { goalId: extra.goalId } : {}),
    ...(extra?.amountPence != null ? { amountPence: extra.amountPence } : {}),
    ...(extra?.clientReqId != null ? { clientReqId: extra.clientReqId } : {}),
    createdAt: serverTimestamp(),
    expiresAt: serverTimestamp(),
  });
}

function assertActiveOrReached(status: GoalStatus) {
  if (status !== 'active' && status !== 'reached') {
    throw new Error('Goal not in active/reached state');
  }
}

function assertParent(actorRole: string | undefined, _familyId: string) {
  if (actorRole !== 'parent' && actorRole !== 'owner') {
    throw new Error('Only a parent or owner may perform this action');
  }
}

// ---------------------------------------------------------------------------
// createGoal
// ---------------------------------------------------------------------------

export interface CreateGoalInput {
  title: string;
  kind: GoalKind;
  targetAmountPence: number;
  currency?: string;
  childId?: string;
  matching?: MatchingPolicy;
  /** Optional external parent seed contribution (never debits a wallet). */
  parentContribution?: ParentContributionInput;
  /** Client-supplied idempotency request id (deterministic key). */
  clientReqId?: string;
}

export const createGoal = async (familyId: string, input: CreateGoalInput) => {
  const actorId = requireActorId();
  if (!Number.isInteger(input.targetAmountPence) || input.targetAmountPence <= 0) {
    throw new Error('Target must be a positive integer number of pence');
  }
  if (input.kind === 'child' && !input.childId) {
    throw new Error('A child goal requires a childId');
  }
  // Validate parent contribution up-front (throws on invalid values before any
  // write). Zero/blank means no contribution.
  const parentPence = validateParentContribution(input.parentContribution, input.targetAmountPence);

  const goalsRef = collection(db, `families/${familyId}/${GOAL_COLLECTION}`);
  const goalDocRef = doc(goalsRef);
  const actorRef = doc(db, 'users', actorId);
  const actorSnap = await getDoc(actorRef);
  const actorRole = actorSnap.exists() ? (actorSnap.data().role as string) : undefined;
  // Children may only create a child-scoped goal for themselves (legacy behaviour).
  if (input.kind === 'child' && actorRole === 'child') {
    if (input.childId !== actorId) throw new Error('A child can only create a goal for themselves');
  } else {
    assertParent(actorRole, familyId);
  }

  // Idempotency / trust-boundary design (fix(goals): enforce seeded goal creation
  // at trust boundary). The goal CREATE rule in firestore.rules now enforces the
  // atomic seed linkage at the RULES layer using getAfter()/existsAfter() on
  // deterministically-addressable sibling documents. To make that possible, every
  // document in the atomic create is addressed by an ID DERIVABLE from
  // request.resource.data (which the rule can read):
  //   - goal doc id            == goalId field (already in request.resource.data)
  //   - contribution leg       == contributions/initialParentContribution (constant)
  //   - ledger entry           == goal_ledger/initialParentLedger (constant)
  //   - idempotency doc        == idempotency/goalCreate_<clientReqId>
  //     where clientReqId is a field stored on the goal doc itself.
  // The rule therefore proves, for any goal created with currentAmountPence > 0,
  // that the matching parent_contribution leg + goal_ledger entry + goal_create
  // idempotency doc were written in the SAME batch with the exact same
  // familyId/goalId/actorId/clientReqId/amount. A direct client write that
  // forges a non-zero balance without those legs is denied at the boundary.
  // When the caller does not supply a clientReqId, derive a deterministic one
  // from the normalised request content (requestHash) so idempotent replay with
  // identical inputs still finds the existing idempotency doc. This keeps replay
  // content-based (the original behaviour) while still exposing a stable,
  // rule-derivable idempotency path for the atomic seed proof.
  const requestHash = requestHashOf({
    title: input.title,
    kind: input.kind,
    targetAmountPence: input.targetAmountPence,
    childId: input.childId,
    parentPence,
  });
  // When the caller does not supply a clientReqId, derive a deterministic one
  // from the normalised request content (requestHash) so idempotent replay with
  // identical inputs still finds the existing idempotency doc. This keeps replay
  // content-based (the original behaviour) while still exposing a stable,
  // rule-derivable idempotency path for the atomic seed proof.
  const clientReqId = input.clientReqId ?? `auto_${requestHash}`;
  const key = `goalCreate_${clientReqId}`;
  const idemRef = doc(db, `families/${familyId}/idempotency/${key}`);
  // Deterministic subdocument ids so the goal-create rule can prove the atomic
  // initial parent-contribution leg + ledger exist (getAfter/existsAfter).
  const contribRef = doc(db, `families/${familyId}/${GOAL_COLLECTION}/${goalDocRef.id}/contributions/initialParentContribution`);
  const ledgerRef = doc(db, `families/${familyId}/${GOAL_COLLECTION}/${goalDocRef.id}/goal_ledger/initialParentLedger`);

  const now = serverTimestamp();
  const goal: Goal = {
    goalId: goalDocRef.id,
    title: input.title,
    kind: input.kind,
    ...(input.childId ? { childId: input.childId } : {}),
    targetAmountPence: input.targetAmountPence,
    currentAmountPence: parentPence,
    currency: input.currency ?? 'GBP',
    status: parentPence >= input.targetAmountPence ? 'reached' : 'active',
    matching: input.matching ?? { mode: 'none', perX: 0, matchY: 0 },
    createdBy: actorId,
    ...(actorSnap.exists() ? { createdByName: actorSnap.data().displayName as string } : {}),
    createdAt: now,
    version: 1,
    // clientReqId is stored on the goal doc so the CREATE rule can derive the
    // deterministic idempotency document path and verify the atomic seed proof.
    clientReqId,
  };

  // Atomic: goal doc + (optional) parent contribution ledger + goal_ledger +
  // idempotency are all written inside one transaction. No wallet is touched,
  // so a parent wallet is never debited.
  let replayRef: any = null;
  await runTransaction(db, async (transaction) => {
    const idemSnap = await transaction.get(idemRef);
    const prior = checkIdempotency(idemSnap, key, requestHash);
    if (prior !== null) {
      // Idempotent replay: the goal (and its atomic parent-contribution proof)
      // already exist. Capture the original goal reference; perform no new writes.
      replayRef = doc(db, `families/${familyId}/${GOAL_COLLECTION}/${prior}`);
      return;
    }

    transaction.set(goalDocRef, goal);

    if (parentPence > 0) {
      transaction.set(contribRef, {
        contribId: contribRef.id,
        goalId: goalDocRef.id,
        type: 'parent_contribution',
        ownerType: 'parent',
        ownerId: actorId,
        amountPence: parentPence,
        matchPence: 0,
        status: 'applied',
        createdBy: actorId,
        createdAt: now,
      });
      transaction.set(ledgerRef, {
        entryId: ledgerRef.id,
        goalId: goalDocRef.id,
        type: 'parent_contribution',
        amountPence: parentPence,
        ownerId: actorId,
        createdAt: now,
      });
    }

    writeIdempotency(transaction, familyId, key, 'goal_create', actorId, requestHash, goalDocRef.id, {
      goalId: goalDocRef.id,
      amountPence: parentPence,
      clientReqId,
    }, idemRef);
  });

  return replayRef ?? goalDocRef;
};

// ---------------------------------------------------------------------------
// updateGoal (parent metadata only)
// ---------------------------------------------------------------------------

export const updateGoal = async (familyId: string, goalId: string, updates: Partial<Goal>) => {
  const actorId = requireActorId();
  const actorRef = doc(db, 'users', actorId);
  const actorSnap = await getDoc(actorRef);
  const actorRole = actorSnap.exists() ? (actorSnap.data().role as string) : undefined;
  assertParent(actorRole, familyId);
  // Metadata only: never allow direct mutation of locked money fields.
  const { currentAmountPence, status, ...safe } = updates as any;
  void currentAmountPence;
  void status;
  await updateDoc(goalRef(familyId, goalId), safe);
};

// ---------------------------------------------------------------------------
// contributeToGoal (child wallet -> goal, atomic; optional approval-gated;
// auto-match leg; manual-match proposal creation)
// ---------------------------------------------------------------------------

export interface ContributeToGoalOptions {
  /** Client-supplied idempotency request id (deterministic key). */
  clientReqId: string;
  /** When true, create a pending goal_request instead of applying immediately. */
  approvalRequired?: boolean;
}

export const contributeToGoal = async (
  familyId: string,
  goalId: string,
  childId: string,
  amountPence: number,
  opts: ContributeToGoalOptions,
) => {
  const actorId = requireActorId();
  if (actorId !== childId) throw new Error('A child can only contribute from their own wallet');
  if (!Number.isInteger(amountPence) || amountPence <= 0) {
    throw new Error('Amount must be a positive integer number of pence');
  }
  const key = goalContributionKey(goalId, opts.clientReqId);
  const requestHash = requestHashOf({ goalId, childId, amountPence, approvalRequired: !!opts.approvalRequired });
  const idemRef = idempotencyRef(familyId, key);
  const walletRef = doc(db, `families/${familyId}/wallets`, childId);
  const goalDocRef = goalRef(familyId, goalId);
  const contribRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/contributions`));
  const ledgerRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/goal_ledger`));
  const txRef = doc(collection(db, `families/${familyId}/wallet_transactions`));
  const requestRef = doc(collection(db, `families/${familyId}/goal_requests`));
  const proposalRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/match_proposals`));
  const approverIds = await getApproverIds(familyId);

  await runTransaction(db, async (transaction) => {
    // ---- PHASE A: ALL READS ----
    const [idemSnap, walletSnap, goalSnap] = await Promise.all([
      transaction.get(idemRef),
      transaction.get(walletRef),
      transaction.get(goalDocRef),
    ]);

    const prior = checkIdempotency(idemSnap, key, requestHash);
    if (prior !== null) return; // idempotent replay, no new writes

    if (!walletSnap.exists()) throw new Error('Wallet not found');
    if (!goalSnap.exists()) throw new Error('Goal not found');
    const goal = normalizeGoalDoc(goalSnap.data());
    assertActiveOrReached(goal.status);
    const walletBalance = walletSnap.data().balance || 0;
    if (walletBalance < amountPence) throw new Error('Insufficient funds');

    let parentNotif = { ref: null, data: null } as Awaited<ReturnType<typeof loadNotificationRecipientsInTransaction>>;
    if (approverIds.length > 0) {
      parentNotif = await loadNotificationRecipientsInTransaction(transaction, familyId, {
        type: 'task_submitted',
        actorId,
        recipientIds: approverIds,
        title: 'Goal contribution',
        body: `${amountPence} pence contributed to ${goal.title}`,
        entityType: 'goal_contribution',
        entityId: contribRef.id,
        actionUrl: '/goals',
        dedupeKey: goalContributionKey(goalId, contribRef.id),
      });
    }

    // ---- PHASE B: WRITES (zero reads) ----
    if (opts.approvalRequired) {
      transaction.set(requestRef, {
        requestType: 'contribution',
        goalId,
        childId,
        amountPence,
        status: 'pending',
        createdBy: actorId,
        createdAt: serverTimestamp(),
        dedupeKey: key,
      });
      writeIdempotency(transaction, familyId, key, 'goal_contribution_request', actorId, requestHash, requestRef.id);
      return;
    }

    // Matching (design §6). Compute the match amount up-front so the goal's
    // currentAmountPence is updated exactly ONCE (a single Firestore rules
    // evaluation), keeping the atomic transaction under the 1000-expression
    // limit even for auto-match goals.
    const policy = goal.matching ?? { mode: 'none', perX: 0, matchY: 0 };
    const matchPence = policy.mode === 'auto' ? computeMatchPence(amountPence, policy) : 0;
    const finalGoalAmount = goal.currentAmountPence + amountPence + matchPence;

    transaction.update(walletRef, { balance: walletBalance - amountPence, lastGoalTxId: txRef.id });
    transaction.update(goalDocRef, {
      currentAmountPence: finalGoalAmount,
      ...(finalGoalAmount >= goal.targetAmountPence ? { status: 'reached' } : {}),
    });
    transaction.set(txRef, {
      type: 'goal_contribution',
      childId,
      goalId,
      amount: -amountPence,
      familyId,
      sourceId: txRef.id,
      status: 'completed',
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    transaction.set(contribRef, {
      contribId: contribRef.id,
      goalId,
      type: 'child_contribution',
      ownerType: 'child',
      ownerId: childId,
      amountPence,
      matchPence: 0,
      status: 'applied',
      walletTxId: txRef.id,
      createdBy: actorId,
      createdAt: serverTimestamp(),
    });
    transaction.set(ledgerRef, {
      entryId: ledgerRef.id,
      goalId,
      type: 'child_contribution',
      amountPence,
      ownerId: childId,
      createdAt: serverTimestamp(),
    });

    if (matchPence > 0) {
      const matchRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/contributions`));
      transaction.set(matchRef, {
        contribId: matchRef.id,
        goalId,
        type: 'auto_match',
        ownerType: 'parent',
        ownerId: actorId,
        amountPence: matchPence,
        matchPence,
        sourceContributionId: contribRef.id,
        status: 'applied',
        createdBy: actorId,
        createdAt: serverTimestamp(),
      });
      transaction.set(doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/goal_ledger`)), {
        entryId: ledgerRef.id + '_m',
        goalId,
        type: 'auto_match',
        amountPence: matchPence,
        ownerId: actorId,
        createdAt: serverTimestamp(),
      });
    } else if (policy.mode === 'manual') {
      const proposedMatchAmountPence = computeMatchPence(amountPence, { ...policy, mode: 'auto' });
      transaction.set(proposalRef, {
        proposalId: proposalRef.id,
        goalId,
        sourceContributionId: contribRef.id,
        proposedMatchAmountPence,
        status: 'proposed',
        createdAt: serverTimestamp(),
      });
    }

    applyNotificationWrites(transaction, parentNotif);
    writeIdempotency(transaction, familyId, key, 'goal_contribution', actorId, requestHash, contribRef.id);
  });
};

// ---------------------------------------------------------------------------
// addParentGoalContribution (external money; no wallet debit)
// ---------------------------------------------------------------------------

export const addParentGoalContribution = async (
  familyId: string,
  goalId: string,
  amountPence: number,
  clientReqId: string,
) => {
  const actorId = requireActorId();
  const actorRef = doc(db, 'users', actorId);
  const actorSnap = await getDoc(actorRef);
  const actorRole = actorSnap.exists() ? (actorSnap.data().role as string) : undefined;
  assertParent(actorRole, familyId);
  if (!Number.isInteger(amountPence) || amountPence <= 0) {
    throw new Error('Amount must be a positive integer number of pence');
  }
  const key = goalContributionKey(goalId, `parent:${clientReqId}`);
  const requestHash = requestHashOf({ goalId, amountPence, parent: true });
  const idemRef = idempotencyRef(familyId, key);
  const goalDocRef = goalRef(familyId, goalId);
  const contribRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/contributions`));
  const ledgerRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/goal_ledger`));

  await runTransaction(db, async (transaction) => {
    const [idemSnap, goalSnap] = await Promise.all([
      transaction.get(idemRef),
      transaction.get(goalDocRef),
    ]);
    const prior = checkIdempotency(idemSnap, key, requestHash);
    if (prior !== null) return;

    if (!goalSnap.exists()) throw new Error('Goal not found');
    const goal = normalizeGoalDoc(goalSnap.data());
    assertActiveOrReached(goal.status);
    const childIds = await getChildIds(familyId);

    let childNotif = { ref: null, data: null } as Awaited<ReturnType<typeof loadNotificationRecipientsInTransaction>>;
    if (childIds.length > 0) {
      childNotif = await loadNotificationRecipientsInTransaction(transaction, familyId, {
        type: 'task_approved',
        actorId,
        recipientIds: childIds,
        title: 'Parent added to goal',
        body: `${amountPence} pence added to ${goal.title}`,
        entityType: 'goal_parent_contribution',
        entityId: contribRef.id,
        actionUrl: '/goals',
        dedupeKey: goalContributionKey(goalId, contribRef.id),
      });
    }

    transaction.update(goalDocRef, {
      currentAmountPence: goal.currentAmountPence + amountPence,
      ...(goal.currentAmountPence + amountPence >= goal.targetAmountPence ? { status: 'reached' } : {}),
    });
    transaction.set(contribRef, {
      contribId: contribRef.id,
      goalId,
      type: 'parent_contribution',
      ownerType: 'parent',
      ownerId: actorId,
      amountPence,
      matchPence: 0,
      status: 'applied',
      createdBy: actorId,
      createdAt: serverTimestamp(),
    });
    transaction.set(ledgerRef, {
      entryId: ledgerRef.id,
      goalId,
      type: 'parent_contribution',
      amountPence,
      ownerId: actorId,
      createdAt: serverTimestamp(),
    });

    applyNotificationWrites(transaction, childNotif);
    writeIdempotency(transaction, familyId, key, 'goal_parent_contribution', actorId, requestHash, contribRef.id);
  });
};

// ---------------------------------------------------------------------------
// requestGoalWithdrawal (child creates a pending withdrawal request)
// ---------------------------------------------------------------------------

export const requestGoalWithdrawal = async (
  familyId: string,
  goalId: string,
  childId: string,
  amountPence: number,
  clientReqId: string,
) => {
  const actorId = requireActorId();
  if (actorId !== childId) throw new Error('A child can only request their own withdrawal');
  if (!Number.isInteger(amountPence) || amountPence <= 0) {
    throw new Error('Amount must be a positive integer number of pence');
  }
  const key = goalWithdrawalKey(goalId, clientReqId);
  const requestHash = requestHashOf({ goalId, childId, amountPence });
  const idemRef = idempotencyRef(familyId, key);
  const goalDocRef = goalRef(familyId, goalId);
  const contribsRef = collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/contributions`);
  const requestRef = doc(collection(db, `families/${familyId}/goal_requests`));
  const approverIds = await getApproverIds(familyId);

  const contribSnap = await getDocs(query(contribsRef));
  await runTransaction(db, async (transaction) => {
    const [idemSnap, goalSnap] = await Promise.all([
      transaction.get(idemRef),
      transaction.get(goalDocRef),
    ]);
    const prior = checkIdempotency(idemSnap, key, requestHash);
    if (prior !== null) return;

    if (!goalSnap.exists()) throw new Error('Goal not found');
    const goal = normalizeGoalDoc(goalSnap.data());
    assertActiveOrReached(goal.status);

    const allLegs: ContributionLeg[] = contribSnap.docs.map((d) => d.data() as ContributionLeg);
    const net = computeNetChild(allLegs, childId);
    if (amountPence > net) throw new Error('Withdrawal exceeds owned contribution');

    let parentNotif = { ref: null, data: null } as Awaited<ReturnType<typeof loadNotificationRecipientsInTransaction>>;
    if (approverIds.length > 0) {
      parentNotif = await loadNotificationRecipientsInTransaction(transaction, familyId, {
        type: 'task_submitted',
        actorId,
        recipientIds: approverIds,
        title: 'Goal withdrawal requested',
        body: `${amountPence} pence requested from ${goal.title}`,
        entityType: 'goal_withdrawal',
        entityId: requestRef.id,
        actionUrl: '/goals',
        dedupeKey: goalWithdrawalKey(goalId, requestRef.id),
      });
    }

    transaction.set(requestRef, {
      requestType: 'withdrawal',
      goalId,
      childId,
      amountPence,
      status: 'pending',
      createdBy: actorId,
      createdAt: serverTimestamp(),
      dedupeKey: key,
    });
    applyNotificationWrites(transaction, parentNotif);
    writeIdempotency(transaction, familyId, key, 'goal_withdrawal_request', actorId, requestHash, requestRef.id);
  });
};

// ---------------------------------------------------------------------------
// approveGoalWithdrawal / rejectGoalWithdrawal
// ---------------------------------------------------------------------------

export const approveGoalWithdrawal = async (familyId: string, requestId: string, clientReqId: string) => {
  const actorId = requireActorId();
  const actorRef = doc(db, 'users', actorId);
  const actorSnap = await getDoc(actorRef);
  const actorRole = actorSnap.exists() ? (actorSnap.data().role as string) : undefined;
  assertParent(actorRole, familyId);

  const key = goalWithdrawalKey(`req:${requestId}`, clientReqId);
  const requestHash = requestHashOf({ requestId, approve: true });
  const idemRef = idempotencyRef(familyId, key);
  const requestRef = doc(db, `families/${familyId}/goal_requests`, requestId);
  const txRef = doc(collection(db, `families/${familyId}/wallet_transactions`));

  await runTransaction(db, async (transaction) => {
    const [idemSnap, reqSnap] = await Promise.all([
      transaction.get(idemRef),
      transaction.get(requestRef),
    ]);
    const prior = checkIdempotency(idemSnap, key, requestHash);
    if (prior !== null) return;

    if (!reqSnap.exists()) throw new Error('Request not found');
    const req = reqSnap.data();
    if (req.status !== 'pending') throw new Error('Request is not pending');
    const goalId: string = req.goalId;
    const childId: string = req.childId;
    const amountPence: number = req.amountPence;

    const goalDocRef = goalRef(familyId, goalId);
    const walletRef = doc(db, `families/${familyId}/wallets`, childId);
    const contribsRef = collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/contributions`);
    const contribSnap = await getDocs(query(contribsRef));
    const [goalSnap, walletSnap] = await Promise.all([
      transaction.get(goalDocRef),
      transaction.get(walletRef),
    ]);
    if (!goalSnap.exists()) throw new Error('Goal not found');
    const goal = normalizeGoalDoc(goalSnap.data());
    assertActiveOrReached(goal.status);
    if (!walletSnap.exists()) throw new Error('Wallet not found');

    const allLegs: ContributionLeg[] = contribSnap.docs.map((d) => d.data() as ContributionLeg);
    const net = computeNetChild(allLegs, childId);
    if (amountPence > net) throw new Error('Withdrawal exceeds owned contribution');

    const walletBalance = walletSnap.data().balance || 0;
    const newGoalAmount = goal.currentAmountPence - amountPence;
    const dropsBelow = newGoalAmount < goal.targetAmountPence;
    const newStatus: GoalStatus = dropsBelow && goal.status === 'reached' ? 'active' : goal.status;

    transaction.update(walletRef, { balance: walletBalance + amountPence, lastGoalTxId: txRef.id });
    transaction.update(goalDocRef, { currentAmountPence: newGoalAmount, ...(dropsBelow ? { status: newStatus } : {}) });
    transaction.set(txRef, {
      type: 'goal_return',
      childId,
      goalId,
      amount: amountPence,
      familyId,
      sourceId: txRef.id,
      status: 'completed',
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    const contribRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/contributions`));
    transaction.set(contribRef, {
      contribId: contribRef.id,
      goalId,
      type: 'child_withdrawal',
      ownerType: 'child',
      ownerId: childId,
      amountPence: -amountPence,
      status: 'applied',
      walletTxId: txRef.id,
      sourceRequestId: requestId,
      createdBy: actorId,
      createdAt: serverTimestamp(),
    });
    transaction.set(doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/goal_ledger`)), {
      entryId: contribRef.id,
      goalId,
      type: 'child_withdrawal',
      amountPence: -amountPence,
      ownerId: childId,
      createdAt: serverTimestamp(),
    });
    transaction.update(requestRef, {
      status: 'approved',
      reviewedBy: actorId,
      reviewedByName: actorSnap.exists() ? (actorSnap.data().displayName as string) : undefined,
      reviewedAt: serverTimestamp(),
      contribId: contribRef.id,
      walletTxId: txRef.id,
    });
    writeIdempotency(transaction, familyId, key, 'goal_withdrawal_approve', actorId, requestHash, contribRef.id);
  });
};

export const rejectGoalWithdrawal = async (familyId: string, requestId: string, reason?: string) => {
  const actorId = requireActorId();
  const actorRef = doc(db, 'users', actorId);
  const actorSnap = await getDoc(actorRef);
  const actorRole = actorSnap.exists() ? (actorSnap.data().role as string) : undefined;
  assertParent(actorRole, familyId);
  const requestRef = doc(db, `families/${familyId}/goal_requests`, requestId);
  await runTransaction(db, async (transaction) => {
    const reqSnap = await transaction.get(requestRef);
    if (!reqSnap.exists()) throw new Error('Request not found');
    const req = reqSnap.data();
    if (req.status !== 'pending') throw new Error('Request is not pending');
    transaction.update(requestRef, {
      status: 'rejected',
      reviewedBy: actorId,
      reviewedByName: actorSnap.exists() ? (actorSnap.data().displayName as string) : undefined,
      reviewedAt: serverTimestamp(),
      rejectionReason: reason ?? null,
    });
  });
};

// ---------------------------------------------------------------------------
// completeGoalPurchased (parent-only; no wallet movement)
// ---------------------------------------------------------------------------

export const completeGoalPurchased = async (familyId: string, goalId: string, clientReqId: string) => {
  const actorId = requireActorId();
  const actorRef = doc(db, 'users', actorId);
  const actorSnap = await getDoc(actorRef);
  const actorRole = actorSnap.exists() ? (actorSnap.data().role as string) : undefined;
  assertParent(actorRole, familyId);

  const key = goalContributionKey(goalId, `purchased:${clientReqId}`);
  const requestHash = requestHashOf({ goalId, mode: 'purchased' });
  const idemRef = idempotencyRef(familyId, key);
  const goalDocRef = goalRef(familyId, goalId);

  await runTransaction(db, async (transaction) => {
    const [idemSnap, goalSnap] = await Promise.all([
      transaction.get(idemRef),
      transaction.get(goalDocRef),
    ]);
    const prior = checkIdempotency(idemSnap, key, requestHash);
    if (prior !== null) return;
    if (!goalSnap.exists()) throw new Error('Goal not found');
    const goal = normalizeGoalDoc(goalSnap.data());
    assertActiveOrReached(goal.status);
    transaction.update(goalDocRef, {
      status: 'completed_purchased',
      completedMode: 'purchased',
      completedAt: serverTimestamp(),
      completedBy: actorId,
    });
    writeIdempotency(transaction, familyId, key, 'goal_purchased', actorId, requestHash, goalDocRef.id);
  });
};

// ---------------------------------------------------------------------------
// returnGoalFunds (parent-only; per-child separate refund + goal-doc closure)
// ---------------------------------------------------------------------------

export const returnGoalFunds = async (familyId: string, goalId: string, clientReqId: string) => {
  const actorId = requireActorId();
  const actorRef = doc(db, 'users', actorId);
  const actorSnap = await getDoc(actorRef);
  const actorRole = actorSnap.exists() ? (actorSnap.data().role as string) : undefined;
  assertParent(actorRole, familyId);

  const key = goalWithdrawalKey(goalId, `return:${clientReqId}`);
  const requestHash = requestHashOf({ goalId, mode: 'returned' });
  const idemRef = idempotencyRef(familyId, key);
  const goalDocRef = goalRef(familyId, goalId);
  const contribsRef = collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/contributions`);
  // Transaction.get only accepts DocumentReferences in this SDK; read the
  // contributions collection with getDocs before the transaction. The goal's
  // currentAmountPence and per-child wallet balances remain the atomic guards.
  const contribSnap = await getDocs(query(contribsRef));

  await runTransaction(db, async (transaction) => {
    const [idemSnap, goalSnap] = await Promise.all([
      transaction.get(idemRef),
      transaction.get(goalDocRef),
    ]);
    const prior = checkIdempotency(idemSnap, key, requestHash);
    if (prior !== null) return;
    if (!goalSnap.exists()) throw new Error('Goal not found');
    const goal = normalizeGoalDoc(goalSnap.data());
    assertActiveOrReached(goal.status);

    const allLegs: ContributionLeg[] = contribSnap.docs.map((d) => d.data() as ContributionLeg);
    const childIds = Array.from(new Set(allLegs.filter(l => l.ownerType === 'child').map(l => l.ownerId)));
    // v1 safety limit: bound the number of per-child refund legs before writing.
    if (childIds.length > MAX_CHILD_REFUNDS_PER_GOAL) {
      throw new Error(`Refund would affect ${childIds.length} child wallets; exceeds safety limit of ${MAX_CHILD_REFUNDS_PER_GOAL}`);
    }
    // Read ALL child wallets up front (before any write) so the transaction
    // respects Firestore's "all reads before all writes" constraint. A missing
    // wallet doc makes the operation fail closed (atomic rollback).
    const walletRefs = childIds.map((cid) => doc(db, `families/${familyId}/wallets`, cid));
    const walletSnaps = await Promise.all(walletRefs.map((ref) => transaction.get(ref)));
    let remaining = goal.currentAmountPence;
    for (let i = 0; i < childIds.length; i++) {
      const cid = childIds[i];
      const net = computeNetChild(allLegs, cid);
      if (net <= 0) continue;
      const walletSnap = walletSnaps[i];
      if (!walletSnap.exists()) throw new Error('Wallet not found');
      const walletRef = walletRefs[i];
      const walletBalance = walletSnap.data().balance || 0;
      const txRef = doc(collection(db, `families/${familyId}/wallet_transactions`));
      const contribRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/contributions`));
      const ledgerRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/goal_ledger`));
      transaction.update(walletRef, { balance: walletBalance + net, lastGoalTxId: txRef.id });
      remaining -= net;
      // The refund is recorded as a goal_return wallet_txn (carries goalId,
      // childId, amount) AND an immutable completion_refund contribution leg +
      // goal_ledger entry. The contributions ledger is the authoritative
      // ownership/accounting source of truth; each refunded child receives an
      // immutable completion_refund entry so the ledger always balances and
      // netChild accounting stays correct.
      transaction.set(txRef, {
        type: 'goal_return',
        childId: cid,
        goalId,
        amount: net,
        familyId,
        sourceId: txRef.id,
        status: 'completed',
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      transaction.set(contribRef, {
        contribId: contribRef.id,
        goalId,
        type: 'completion_refund',
        ownerType: 'child',
        ownerId: cid,
        amountPence: -net,
        status: 'applied',
        walletTxId: txRef.id,
        createdBy: actorId,
        createdAt: serverTimestamp(),
      });
      transaction.set(ledgerRef, {
        entryId: ledgerRef.id,
        goalId,
        type: 'completion_refund',
        amountPence: -net,
        ownerId: cid,
        createdAt: serverTimestamp(),
      });
    }

    // Parent + match portions are closed out with an immutable external_closure
    // contribution leg + goal_ledger entry (NOT wallet-credited, NOT a scalar on
    // the goal doc). This keeps the contributions ledger as the single source of
    // truth and ensures the ledger always balances:
    //   Σ child refunds + Σ external_closure == original currentAmountPence.
    if (remaining > 0) {
      const closureRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/contributions`));
      const closureLedgerRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/goal_ledger`));
      transaction.set(closureRef, {
        contribId: closureRef.id,
        goalId,
        type: 'external_closure',
        ownerType: 'parent',
        ownerId: actorId,
        amountPence: -remaining,
        status: 'applied',
        createdBy: actorId,
        createdAt: serverTimestamp(),
      });
      transaction.set(closureLedgerRef, {
        entryId: closureLedgerRef.id,
        goalId,
        type: 'external_closure',
        amountPence: -remaining,
        ownerId: actorId,
        createdAt: serverTimestamp(),
      });
    }
    transaction.update(goalDocRef, {
      currentAmountPence: 0,
      status: 'completed_returned',
      completedMode: 'returned',
      familyId,
      completedAt: serverTimestamp(),
      completedBy: actorId,
    });
    writeIdempotency(transaction, familyId, key, 'goal_returned', actorId, requestHash, goalDocRef.id);
  });
};

// ---------------------------------------------------------------------------
// cancelGoal (parent-only; only when active and empty, else equivalent to return)
// ---------------------------------------------------------------------------

export const cancelGoal = async (familyId: string, goalId: string, clientReqId: string) => {
  const actorId = requireActorId();
  const actorRef = doc(db, 'users', actorId);
  const actorSnap = await getDoc(actorRef);
  const actorRole = actorSnap.exists() ? (actorSnap.data().role as string) : undefined;
  assertParent(actorRole, familyId);

  const key = goalWithdrawalKey(goalId, `cancel:${clientReqId}`);
  const requestHash = requestHashOf({ goalId, mode: 'cancelled' });
  const idemRef = idempotencyRef(familyId, key);
  const goalDocRef = goalRef(familyId, goalId);

  await runTransaction(db, async (transaction) => {
    const [idemSnap, goalSnap] = await Promise.all([
      transaction.get(idemRef),
      transaction.get(goalDocRef),
    ]);
    const prior = checkIdempotency(idemSnap, key, requestHash);
    if (prior !== null) return;
    if (!goalSnap.exists()) throw new Error('Goal not found');
    const goal = normalizeGoalDoc(goalSnap.data());
    if (goal.status !== 'active') throw new Error('Goal not in active/reached state');
    if (goal.currentAmountPence > 0) {
      // Money present: cancel == return funds (design §5.7).
      await applyReturnFundsInTransaction(transaction, familyId, goal, actorId);
    }
    transaction.update(goalDocRef, {
      status: 'cancelled',
      completedMode: 'cancelled',
      completedAt: serverTimestamp(),
      completedBy: actorId,
    });
    writeIdempotency(transaction, familyId, key, 'goal_cancelled', actorId, requestHash, goalDocRef.id);
  });
};

// ---------------------------------------------------------------------------
// deleteCancelledGoal (parent/owner only; cancelled + zero-balance goal)
// ---------------------------------------------------------------------------
// Permanently removes a CANCELLED, zero-balance goal display document. This is
// the ONLY goal-deletion path and it is deliberately narrow:
//   - actor must be a parent/owner in the same family (assertParent)
//   - goal.status must be exactly 'cancelled'
//   - goal.currentAmountPence must be 0 (no remaining funds)
//   - there must be NO unresolved withdrawal or match proposals
//   - the idempotency guard prevents duplicate/forged deletes
// Accounting history is NEVER deleted: the goal's subcollections
// (contributions, goal_ledger, match_proposals) and the family-level
// wallet_transactions are left intact for audit. Firestore deleteDoc removes
// only the single goal display document, not its subcollections, so historical
// screens that query by goalId keep working.
export const deleteCancelledGoal = async (
  familyId: string,
  goalId: string,
  clientReqId: string,
) => {
  const actorId = requireActorId();
  const actorRef = doc(db, 'users', actorId);
  const actorSnap = await getDoc(actorRef);
  const actorRole = actorSnap.exists() ? (actorSnap.data().role as string) : undefined;
  assertParent(actorRole, familyId);

  const key = goalWithdrawalKey(goalId, `delete:${clientReqId}`);
  const requestHash = requestHashOf({ goalId, mode: 'deleted' });
  const idemRef = idempotencyRef(familyId, key);
  const goalDocRef = goalRef(familyId, goalId);
  // transaction.get only accepts DocumentReferences in this SDK; read the
  // match_proposals subcollection with getDocs before the transaction. The
  // goal's status/currentAmountPence remain the atomic guards inside it.
  const proposalsRef = collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/match_proposals`);
  const proposalsSnap = await getDocs(query(proposalsRef));

  await runTransaction(db, async (transaction) => {
    const [idemSnap, goalSnap] = await Promise.all([
      transaction.get(idemRef),
      transaction.get(goalDocRef),
    ]);
    const prior = checkIdempotency(idemSnap, key, requestHash);
    if (prior !== null) return;
    if (!goalSnap.exists()) throw new Error('Goal not found');
    const goal = normalizeGoalDoc(goalSnap.data());
    // Exact status/fund checks at write time (fail closed).
    if (goal.status !== 'cancelled') {
      throw new Error('Only a cancelled goal can be deleted');
    }
    if (goal.currentAmountPence > 0) {
      throw new Error('Cannot delete a goal with remaining funds');
    }
    // No unresolved withdrawal or match proposals may remain.
    const unresolved = proposalsSnap.docs.filter(
      (d: any) => d.data() && d.data().status === 'proposed',
    );
    if (unresolved.length > 0) {
      throw new Error('Resolve all open match proposals before deleting this goal');
    }
    transaction.delete(goalDocRef);
    writeIdempotency(transaction, familyId, key, 'goal_deleted', actorId, requestHash, goalDocRef.id, { goalId });
  });
};

async function applyReturnFundsInTransaction(
  transaction: any,
  familyId: string,
  goal: Goal,
  _actorId: string,
) {
  const contribsRef = collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goal.goalId}/contributions`);
  const contribSnap = await getDocs(query(contribsRef));
  const allLegs: ContributionLeg[] = contribSnap.docs.map((d) => d.data() as ContributionLeg);
  const childIds = Array.from(new Set(allLegs.filter(l => l.ownerType === 'child').map(l => l.ownerId)));
  // v1 safety limit: bound the number of per-child refund legs before writing.
  if (childIds.length > MAX_CHILD_REFUNDS_PER_GOAL) {
    throw new Error(`Refund would affect ${childIds.length} child wallets; exceeds safety limit of ${MAX_CHILD_REFUNDS_PER_GOAL}`);
  }
  let remaining = goal.currentAmountPence;
  const goalDocRef = goalRef(familyId, goal.goalId!);
  // Read ALL child wallets up front (before any write) so the transaction
  // respects Firestore's "all reads before all writes" constraint. A missing
  // wallet doc makes the operation fail closed (atomic rollback).
  const walletRefs = childIds.map((cid) => doc(db, `families/${familyId}/wallets`, cid));
  const walletSnaps = await Promise.all(walletRefs.map((ref) => transaction.get(ref)));
  for (let i = 0; i < childIds.length; i++) {
    const cid = childIds[i];
    const net = computeNetChild(allLegs, cid);
    if (net <= 0) continue;
    const walletSnap = walletSnaps[i];
    if (!walletSnap.exists()) throw new Error('Wallet not found');
    const walletRef = walletRefs[i];
    const walletBalance = walletSnap.data().balance || 0;
    const txRef = doc(collection(db, `families/${familyId}/wallet_transactions`));
    const contribRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goal.goalId}/contributions`));
    const ledgerRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goal.goalId}/goal_ledger`));
    transaction.update(walletRef, { balance: walletBalance + net, lastGoalTxId: txRef.id });
    remaining -= net;
    // Refund recorded as a goal_return wallet_txn (carries goalId, childId,
    // amount) AND an immutable completion_refund contribution leg + goal_ledger
    // entry. The contributions ledger is the authoritative ownership/accounting
    // source of truth; each refunded child receives an immutable completion_refund
    // entry so the ledger always balances and netChild accounting stays correct.
    transaction.set(txRef, {
      type: 'goal_return',
      childId: cid,
      goalId: goal.goalId,
      amount: net,
      familyId,
      sourceId: txRef.id,
      status: 'completed',
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    transaction.set(contribRef, {
      contribId: contribRef.id,
      goalId: goal.goalId,
      type: 'completion_refund',
      ownerType: 'child',
      ownerId: cid,
      amountPence: -net,
      status: 'applied',
      walletTxId: txRef.id,
      createdBy: _actorId,
      createdAt: serverTimestamp(),
    });
    transaction.set(ledgerRef, {
      entryId: ledgerRef.id,
      goalId: goal.goalId,
      type: 'completion_refund',
      amountPence: -net,
      ownerId: cid,
      createdAt: serverTimestamp(),
    });
  }
  // Parent + match portions closed out with an immutable external_closure
  // contribution leg + goal_ledger entry (NOT wallet-credited, NOT a scalar on
  // the goal doc). The contributions ledger stays the single source of truth.
  if (remaining > 0) {
    const closureRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goal.goalId}/contributions`));
    const closureLedgerRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goal.goalId}/goal_ledger`));
    transaction.set(closureRef, {
      contribId: closureRef.id,
      goalId: goal.goalId,
      type: 'external_closure',
      ownerType: 'parent',
      ownerId: _actorId,
      amountPence: -remaining,
      status: 'applied',
      createdBy: _actorId,
      createdAt: serverTimestamp(),
    });
    transaction.set(closureLedgerRef, {
      entryId: closureLedgerRef.id,
      goalId: goal.goalId,
      type: 'external_closure',
      amountPence: -remaining,
      ownerId: _actorId,
      createdAt: serverTimestamp(),
    });
  }
  transaction.update(goalDocRef, { currentAmountPence: 0, familyId });
}

// ---------------------------------------------------------------------------
// Manual match proposals (design §5.3)
// ---------------------------------------------------------------------------

export const createMatchProposal = async (
  familyId: string,
  goalId: string,
  sourceContributionId: string,
  proposedMatchAmountPence: number,
  clientReqId?: string,
) => {
  const actorId = requireActorId();
  if (!Number.isInteger(proposedMatchAmountPence) || proposedMatchAmountPence <= 0) {
    throw new Error('Match amount must be a positive integer number of pence');
  }
  // Deterministic idempotency key so a double-tap (or a retried network call)
  // cannot create a duplicate proposal. When the caller does not supply a
  // clientReqId we derive one from the normalised request content so identical
  // replays still collapse to the same proposal.
  const key = goalMatchKey(sourceContributionId, clientReqId ?? `auto_${requestHashOf({ goalId, sourceContributionId, proposedMatchAmountPence })}`);
  const requestHash = requestHashOf({ goalId, sourceContributionId, proposedMatchAmountPence });
  const idemRef = idempotencyRef(familyId, key);
  const proposalRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/match_proposals`));

  let replayRef: any = null;
  await runTransaction(db, async (transaction) => {
    // ---- PHASE A: ALL READS ----
    const [idemSnap, goalSnap] = await Promise.all([
      transaction.get(idemRef),
      transaction.get(goalRef(familyId, goalId)),
    ]);
    const prior = checkIdempotency(idemSnap, key, requestHash);
    if (prior !== null) {
      // Idempotent replay: the proposal already exists. Capture its reference
      // and perform no new writes.
      replayRef = doc(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/match_proposals`, prior);
      return;
    }
    if (!goalSnap.exists()) throw new Error('Goal not found');
    const goal = normalizeGoalDoc(goalSnap.data());
    assertActiveOrReached(goal.status);

    // ---- PHASE B: WRITES (zero reads) ----
    // serverTimestamp() resolves to request.time inside a transaction, which
    // satisfies the match_proposals create rule (data.createdAt == request.time).
    transaction.set(proposalRef, {
      proposalId: proposalRef.id,
      goalId,
      sourceContributionId,
      proposedMatchAmountPence,
      status: 'proposed',
      createdBy: actorId,
      createdAt: serverTimestamp(),
    } as MatchProposal);
    writeIdempotency(transaction, familyId, key, 'goal_match_proposal', actorId, requestHash, proposalRef.id, {
      goalId,
      amountPence: proposedMatchAmountPence,
    }, idemRef);
  });

  return replayRef ?? proposalRef;
};

export const approveMatchProposal = async (
  familyId: string,
  goalId: string,
  proposalId: string,
  clientReqId: string,
) => {
  const actorId = requireActorId();
  const actorRef = doc(db, 'users', actorId);
  const actorSnap = await getDoc(actorRef);
  const actorRole = actorSnap.exists() ? (actorSnap.data().role as string) : undefined;
  assertParent(actorRole, familyId);

  const key = goalMatchKey(proposalId, clientReqId);
  const requestHash = requestHashOf({ goalId, proposalId, approve: true });
  const idemRef = idempotencyRef(familyId, key);
  const proposalRef = doc(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/match_proposals`, proposalId);
  const goalDocRef = goalRef(familyId, goalId);

  await runTransaction(db, async (transaction) => {
    const [idemSnap, proposalSnap, goalSnap] = await Promise.all([
      transaction.get(idemRef),
      transaction.get(proposalRef),
      transaction.get(goalDocRef),
    ]);
    const prior = checkIdempotency(idemSnap, key, requestHash);
    if (prior !== null) return;
    if (!proposalSnap.exists()) throw new Error('Match proposal not found');
    const proposal = proposalSnap.data();
    if (proposal.status !== 'proposed') throw new Error('Match proposal is not pending');
    if (!goalSnap.exists()) throw new Error('Goal not found');
    const goal = normalizeGoalDoc(goalSnap.data());
    assertActiveOrReached(goal.status);

    const matchPence = proposal.proposedMatchAmountPence as number;
    const matchRef = doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/contributions`));
    transaction.update(goalDocRef, { currentAmountPence: goal.currentAmountPence + matchPence });
    transaction.set(matchRef, {
      contribId: matchRef.id,
      goalId,
      type: 'manual_match',
      ownerType: 'parent',
      ownerId: actorId,
      amountPence: matchPence,
      matchPence,
      sourceContributionId: proposal.sourceContributionId,
      proposedMatchAmountPence: matchPence,
      status: 'applied',
      createdBy: actorId,
      createdAt: serverTimestamp(),
    });
    transaction.set(doc(collection(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/goal_ledger`)), {
      entryId: matchRef.id,
      goalId,
      type: 'manual_match',
      amountPence: matchPence,
      ownerId: actorId,
      createdAt: serverTimestamp(),
    });
    transaction.update(proposalRef, {
      status: 'approved',
      reviewedBy: actorId,
      reviewedByName: actorSnap.exists() ? (actorSnap.data().displayName as string) : undefined,
      reviewedAt: serverTimestamp(),
    });
    writeIdempotency(transaction, familyId, key, 'goal_match_approve', actorId, requestHash, matchRef.id);
  });
};

export const rejectMatchProposal = async (
  familyId: string,
  goalId: string,
  proposalId: string,
) => {
  const actorId = requireActorId();
  const actorRef = doc(db, 'users', actorId);
  const actorSnap = await getDoc(actorRef);
  const actorRole = actorSnap.exists() ? (actorSnap.data().role as string) : undefined;
  assertParent(actorRole, familyId);
  const proposalRef = doc(db, `families/${familyId}/${GOAL_COLLECTION}/${goalId}/match_proposals`, proposalId);
  await runTransaction(db, async (transaction) => {
    const proposalSnap = await transaction.get(proposalRef);
    if (!proposalSnap.exists()) throw new Error('Match proposal not found');
    const proposal = proposalSnap.data();
    if (proposal.status !== 'proposed') throw new Error('Match proposal is not pending');
    transaction.update(proposalRef, {
      status: 'rejected',
      reviewedBy: actorId,
      reviewedByName: actorSnap.exists() ? (actorSnap.data().displayName as string) : undefined,
      reviewedAt: serverTimestamp(),
    });
  });
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
  const actorId = auth.currentUser?.uid;
  if (!actorId) throw new Error('Not authenticated');
  // The canonical fund balance may legitimately go negative: parents pay real
  // pet expenses from their own money, and children later contribute to cover
  // the deficit. We therefore only validate the amount itself — never the
  // resulting balance.
  if (!Number.isInteger(expenseData.amount) || expenseData.amount <= 0) {
    throw new Error('Amount must be a positive integer number of pence');
  }
  const fundRef = doc(db, `families/${familyId}/funds`, fundId);
  const txRef = doc(collection(db, `families/${familyId}/fund_transactions`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));

  await runTransaction(db, async (transaction) => {
    const fundDoc = await transaction.get(fundRef);
    if (!fundDoc.exists()) throw new Error("Fund not found");

    const currentBalance = fundDoc.data().balance || 0;

    // Resolve the notification dedupe read up-front (reads-before-writes).
    const childIds = await getChildIds(familyId);
    let notifPlan = { ref: null, data: null } as Awaited<
      ReturnType<typeof loadNotificationRecipientsInTransaction>
    >;
    if (childIds.length > 0) {
      notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
        type: 'petbox_expense',
        actorId,
        recipientIds: childIds,
        title: 'Pet Box update',
        body: `£${(expenseData.amount/100).toFixed(2)} expense added to ${expenseData.fundName}`,
        entityType: 'fund_transaction',
        entityId: txRef.id,
        actionUrl: '/pet-box',
        dedupeKey: petboxExpenseKey(txRef.id),
      });
    }

    transaction.update(fundRef, { balance: currentBalance - expenseData.amount, lastFundTxId: txRef.id });
    transaction.set(txRef, {
      fundId,
      type: "expense",
      amount: expenseData.amount,
      category: expenseData.category,
      description: expenseData.description,
      familyId,
      sourceId: txRef.id,
      actorId,
      status: 'completed',
      effectSnapshot: effectSnapshot({ entityType: 'fund_transaction', familyId, actorId, fundId, fundDeltaPence: -expenseData.amount }),
      createdAt: serverTimestamp()
    });

    transaction.set(feedRef, {
      actorId,
      type: 'custom',
      text: `Added £${(expenseData.amount/100).toFixed(2)} expense for ${expenseData.fundName}: ${expenseData.description}`,
      timestamp: serverTimestamp()
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
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
  const actorId = auth.currentUser?.uid;
  if (!actorId) throw new Error('Not authenticated');
  if (actorId !== userId) throw new Error('Cannot create a contribution for another user');
  const reqRef = doc(collection(db, `families/${familyId}/petbox_requests`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const approverIds = await getApproverIds(familyId);

  await runTransaction(db, async (transaction) => {
    // Resolve the notification dedupe read up-front (reads-before-writes).
    let notifPlan = { ref: null, data: null } as Awaited<
      ReturnType<typeof loadNotificationRecipientsInTransaction>
    >;
    if (approverIds.length > 0) {
      notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
        type: 'petbox_contribution',
        actorId,
        recipientIds: approverIds,
        title: 'Pet Box contribution',
        body: `${userName} wants to donate £${(amount/100).toFixed(2)} to ${fundName}`,
        entityType: 'petbox_request',
        entityId: reqRef.id,
        actionUrl: '/pet-box',
        dedupeKey: petboxContributionKey(reqRef.id),
      });
    }

    transaction.set(reqRef, {
      familyId,
      fundId,
      fundName,
      childId: actorId,
      childName: userName,
      amountPence: amount,
      status: 'pending',
      createdAt: serverTimestamp()
    });

    transaction.set(feedRef, {
      actorId,
      text: `${userName} wants to donate £${(amount/100).toFixed(2)} to ${fundName}. Awaiting parent approval.`,
      timestamp: serverTimestamp()
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
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

    transaction.set(userWalletRef, {
      balance: currentWallet - reqData.amountPence,
      lastTransferTxId: approvalTxId,
      lastTransferReqId: requestId,
    }, { merge: true });

    transaction.update(fundRef, {
      balance: currentFundBalance + reqData.amountPence,
      lastFundTxId: txRef.id
    });

    transaction.set(txRef, {
      fundId: reqData.fundId,
      type: "contribution",
      amount: reqData.amountPence,
      fromUserId: reqData.childId,
      sourceId: requestId,
      familyId,
      actorId: currentUserUid,
      status: 'completed',
      effectSnapshot: effectSnapshot({ entityType: 'petbox_donation', familyId, actorId: currentUserUid, childId: reqData.childId, fundId: reqData.fundId, sourceRequestId: requestId, fundDeltaPence: reqData.amountPence, walletDeltaPence: -reqData.amountPence }),
      createdAt: serverTimestamp()
    });

    transaction.set(walletTxRef, {
      type: 'petbox_donation',
      childId: reqData.childId,
      amountPence: -reqData.amountPence,
      amount: -reqData.amountPence,
      note: `Donated to ${reqData.fundName}`,
      sourceId: requestId,
      familyId,
      actorId: currentUserUid,
      status: 'completed',
      effectSnapshot: effectSnapshot({ entityType: 'petbox_donation', familyId, actorId: currentUserUid, childId: reqData.childId, fundId: reqData.fundId, sourceRequestId: requestId, fundDeltaPence: reqData.amountPence, walletDeltaPence: -reqData.amountPence }),
      createdAt: serverTimestamp(),
      timestamp: serverTimestamp()
    });

    transaction.update(reqRef, {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUserUid,
      approvalTxId,
      fundTransactionId: txRef.id,
      effectSnapshot: effectSnapshot({ entityType: 'petbox_donation', familyId, actorId: currentUserUid, childId: reqData.childId, fundId: reqData.fundId, sourceRequestId: requestId, fundDeltaPence: reqData.amountPence, walletDeltaPence: -reqData.amountPence }),
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

export const rejectPetBoxDonation = async (familyId: string, requestId: string, rejectionReason: string) => {
  if (!rejectionReason.trim()) throw new Error('Rejection reason is required');
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
      reviewedBy: currentUserUid,
      rejectionReason: rejectionReason.trim()
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
// 8b. PROFILE UPDATE REQUESTS (child -> parent approval)
// ---------------------------
//
// Children cannot edit their own display name / avatar directly. They submit a
// `profile_update_requests` document that flows through the SAME Approval Center
// workflow used by tasks, transfers, money and pet box requests. Owner/Parent
// edits apply immediately elsewhere (EditMemberModal / ProfileEditorModal for
// non-child roles); only children route through this request + approval path.

export const PROFILE_DISPLAY_NAME_MAX = 40;

/**
 * Validates raw profile-edit input. Returns trimmed, safe values or throws a
 * friendly, user-facing error (never a raw Firebase message). Shared by the
 * client editor and the submit API so validation is identical in both places.
 *
 * Avatars are now selected from the curated catalog by `avatarId`. A raw URL is
 * only accepted as a *legacy fallback* (an existing profile image); children
 * can never submit an arbitrary new URL. `avatarId` must reference an active
 * catalog entry that the child is allowed to use (starter or already owned).
 */
export function validateProfileUpdateInput(
  displayName: string,
  avatarId: string | null,
  opts?: { ownedAvatarIds?: string[]; legacyAvatarUrl?: string | null },
): { displayName: string; avatarId: string | null; legacyAvatarUrl: string | null } {
  const name = (displayName ?? '').trim();
  if (!name) throw new Error('Display name cannot be empty.');
  if (name.length > PROFILE_DISPLAY_NAME_MAX) {
    throw new Error(`Display name must be ${PROFILE_DISPLAY_NAME_MAX} characters or fewer.`);
  }

  const id = (avatarId ?? '').trim();
  const legacy = opts?.legacyAvatarUrl ?? null;

  if (id) {
    const def = getAvatarById(id);
    if (!def || !def.isActive) {
      throw new Error('This avatar is no longer available. Please choose another.');
    }
    // Starter avatars are free for everyone. Premium avatars must be owned.
    if (def.unlockType === 'points' && !(opts?.ownedAvatarIds ?? []).includes(id)) {
      throw new Error('This avatar has not been unlocked yet.');
    }
    return { displayName: name, avatarId: id, legacyAvatarUrl: null };
  }

  // No catalog id: keep the legacy URL if one exists (never accept a new raw URL).
  return { displayName: name, avatarId: null, legacyAvatarUrl: legacy };
}

/** True when the value is a valid http(s) URL. Empty string is allowed (keeps current avatar). */
export function isValidAvatarUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Child submits a profile update request. The child's `users/{childId}` document
 * is NOT modified here — only the request is created. A pre-flight `getDocs`
 * guard plus the disabled editor in the UI prevent multiple active requests;
 * the transaction then creates the request atomically alongside the feed entry
 * and the parent/owner notification.
 */
export const submitProfileUpdateRequest = async (
  familyId: string,
  requestedDisplayName: string,
  requestedAvatarId: string | null,
  opts?: { ownedAvatarIds?: string[]; legacyAvatarUrl?: string | null },
) => {
  const currentUserUid = requireActorId();
  const { displayName, avatarId, legacyAvatarUrl } = validateProfileUpdateInput(
    requestedDisplayName,
    requestedAvatarId,
    { ownedAvatarIds: opts?.ownedAvatarIds, legacyAvatarUrl: opts?.legacyAvatarUrl },
  );

  const userRef = doc(db, 'users', currentUserUid);
  const reqRef = doc(collection(db, `families/${familyId}/profile_update_requests`));
  const approverIds = await getApproverIds(familyId);

  // Pre-flight guard: block a second active request before opening the transaction.
  // Reuses the same (childId, createdAt) index as the child bootstrap query.
  const pendingQuery = query(
    collection(db, `families/${familyId}/profile_update_requests`),
    where('childId', '==', currentUserUid),
    orderBy('createdAt', 'desc'),
  );
  const existing = await getDocs(pendingQuery);
  if (existing.docs.some(d => d.data().status === 'pending')) {
    throw new Error('You already have a profile change waiting for approval.');
  }

  await runTransaction(db, async (transaction) => {
    // ---------------------------------------------------------------------
    // PHASE A — ALL READS (no writes may occur before this phase completes)
    // ---------------------------------------------------------------------
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error('User not found');
    const userData = userDoc.data();

    // Resolve the notification dedupe read up-front so the write phase never
    // performs a transaction.get (Firestore requires reads-before-writes).
    let notificationPlan = { ref: null, data: null } as Awaited<
      ReturnType<typeof loadNotificationRecipientsInTransaction>
    >;
    if (approverIds.length > 0) {
      notificationPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
        type: 'profile_update_requested',
        actorId: currentUserUid,
        recipientIds: approverIds,
        title: 'Profile update approval needed',
        body: `${userData.displayName} wants to update their profile.`,
        entityType: 'profile_update_request',
        entityId: reqRef.id,
        dedupeKey: profileUpdateRequestedKey(reqRef.id),
      });
    }

    // ---------------------------------------------------------------------
    // PHASE B — PURE VALIDATION (no reads, no writes)
    // ---------------------------------------------------------------------
    if (userData.role !== 'child') throw new Error('Only children can request profile updates.');
    if (userData.familyId !== familyId) throw new Error('Your family membership could not be verified.');

    // Re-validate the requested avatar against the live profile to prevent forging.
    const currentAvatarId = userData.avatarId || null;
    const currentLegacyUrl = userData.avatarUrl || '';
    if (avatarId && avatarId !== currentAvatarId) {
      const def = getAvatarById(avatarId);
      if (!def) throw new Error('This avatar is no longer available. Please choose another.');
      if (def.unlockType === 'points' && !(opts?.ownedAvatarIds ?? []).includes(avatarId)) {
        throw new Error('This avatar has not been unlocked yet.');
      }
    }

    const requestedImage = avatarId
      ? (getAvatarById(avatarId)?.imageUrl ?? '')
      : (legacyAvatarUrl || currentLegacyUrl || '');

    // ---------------------------------------------------------------------
    // PHASE C — WRITES ONLY (no transaction.get may occur from here on)
    // ---------------------------------------------------------------------
    transaction.set(reqRef, {
      id: reqRef.id,
      familyId,
      childId: currentUserUid,
      childName: userData.displayName,
      requestedDisplayName: displayName,
      requestedAvatarId: avatarId,
      requestedAvatar: requestedImage,
      currentDisplayName: userData.displayName,
      currentAvatarId: currentAvatarId,
      currentAvatar: currentLegacyUrl,
      status: 'pending',
      createdAt: serverTimestamp(),
      actorId: currentUserUid,
    });

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `${userData.displayName} requested a profile update. Awaiting parent approval.`,
      visibleTo: [currentUserUid, ...approverIds],
      timestamp: serverTimestamp(),
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notificationPlan);
  });
};

/**
 * Securely unlock a premium avatar for the authenticated child.
 *
 * Atomic transaction guarantees (see Firestore rules for the write-side mirror):
 *  1. The caller is the child (actorId == auth.uid).
 *  2. The avatar exists and is active.
 *  3. It is a premium (points) avatar.
 *  4. The child does not already own it (duplicate unlock denied).
 *  5. The cost is taken from the AUTHORITATIVE catalog, never the client.
 *  6. The exact point cost is deducted from `rewardPoints`.
 *  7. An immutable unlock record is written under
 *     families/{familyId}/users/{userId}/avatar_unlocks/{avatarId}.
 *  8. No partial writes — either the unlock + deduction both commit or neither.
 *
 * Selecting the avatar afterwards is a separate, free action (profile update).
 */
export const unlockAvatar = async (familyId: string, avatarId: string): Promise<number> => {
  const currentUserUid = requireActorId();
  const def = getAvatarById(avatarId);
  if (!def || !def.isActive) throw new Error('This avatar is no longer available.');
  if (def.unlockType !== 'points') throw new Error('This avatar is already free.');

  // Authoritative cost — the client-supplied value is ignored entirely.
  const cost = getAvatarCost(avatarId);
  if (cost == null) throw new Error('This avatar is no longer available.');

  const userRef = doc(db, 'users', currentUserUid);
  const unlockRef = doc(db, `families/${familyId}/users/${currentUserUid}/avatar_unlocks/${avatarId}`);

  await runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error('User not found');
    const userData = userDoc.data();
    if (userData.role !== 'child') throw new Error('Only children can unlock avatars.');
    if (userData.familyId !== familyId) throw new Error('Your family membership could not be verified.');

    const unlockDoc = await transaction.get(unlockRef);
    if (unlockDoc.exists()) throw new Error('You already own this avatar.');

    const currentPoints = userData.rewardPoints || 0;
    if (currentPoints < cost) {
      throw new Error(`You need ${cost - currentPoints} more points to unlock this avatar.`);
    }

    transaction.update(userRef, { rewardPoints: currentPoints - cost });
    transaction.set(unlockRef, {
      avatarId,
      userId: currentUserUid,
      familyId,
      unlockedAt: serverTimestamp(),
      costPoints: cost,
      source: 'points',
      actorId: currentUserUid,
    });
  });

  return cost;
};

/**
 * Parent/Owner approves a profile update request. Atomic: validates the request,
 * re-validates the child still belongs to the family, updates the profile, marks
 * the request approved, writes a feed entry and notifies the child. No partial
 * writes — every step shares the same transaction.
 */
export const approveProfileUpdateRequest = async (familyId: string, requestId: string) => {
  const reqRef = doc(db, `families/${familyId}/profile_update_requests`, requestId);
  const currentUserUid = requireActorId();

  await runTransaction(db, async (transaction) => {
    const reqDoc = await transaction.get(reqRef);
    if (!reqDoc.exists()) throw new Error('Request not found');
    const reqData = reqDoc.data();
    if (reqData.status !== 'pending') throw new Error('Request is not pending approval');

    const userRef = doc(db, 'users', reqData.childId);
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error('Child not found');
    const userData = userDoc.data();
    if (userData.familyId !== familyId || userData.role !== 'child') {
      throw new Error('Child is no longer in this family');
    }

    const reviewerRef = doc(db, 'users', currentUserUid);
    const reviewerDoc = await transaction.get(reviewerRef);
    const reviewerName = reviewerDoc.exists() ? (reviewerDoc.data().displayName || 'Parent') : 'Parent';

    // Resolve the notification dedupe read up-front (reads-before-writes).
    const notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
      type: 'profile_update_approved',
      actorId: currentUserUid,
      recipientIds: [reqData.childId],
      title: 'Profile update approved',
      body: `Your profile update was approved by ${reviewerName}.`,
      entityType: 'profile_update_request',
      entityId: requestId,
      dedupeKey: profileUpdateApprovedKey(requestId),
    });

    // Apply the requested profile change. Resolve the avatar image from the
    // catalog when an avatarId was requested; otherwise keep the current one.
    const nextAvatarId = reqData.requestedAvatarId || userData.avatarId || null;
    const nextAvatar = reqData.requestedAvatar
      ? reqData.requestedAvatar
      : (userData.avatarUrl || '');
    const updateFields: Record<string, unknown> = { displayName: reqData.requestedDisplayName };
    if (nextAvatarId) updateFields.avatarId = nextAvatarId;
    if (nextAvatar) updateFields.avatarUrl = nextAvatar;
    transaction.update(userRef, updateFields);

    transaction.update(reqRef, {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUserUid,
      reviewedByName: reviewerName,
      effectSnapshot: effectSnapshot({
        entityType: 'profile_update',
        familyId,
        actorId: currentUserUid,
        childId: reqData.childId,
        sourceRequestId: requestId,
      }),
    });

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Profile update for ${reqData.childName} was approved.`,
      visibleTo: [reqData.childId, currentUserUid],
      timestamp: serverTimestamp(),
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
  });
};

/**
 * Parent/Owner rejects a profile update request. The child's profile is left
 * untouched, the request is marked rejected (history preserved) and the child
 * is notified. The optional comment is included when provided.
 */
export const rejectProfileUpdateRequest = async (familyId: string, requestId: string, rejectionReason = 'Rejected') => {
  if (!rejectionReason.trim()) throw new Error('Rejection reason is required');
  const reqRef = doc(db, `families/${familyId}/profile_update_requests`, requestId);
  const currentUserUid = requireActorId();

  await runTransaction(db, async (transaction) => {
    const reqDoc = await transaction.get(reqRef);
    if (!reqDoc.exists()) throw new Error('Request not found');
    if (reqDoc.data().status !== 'pending') throw new Error('Request is not pending approval');

    const reviewerRef = doc(db, 'users', currentUserUid);
    const reviewerDoc = await transaction.get(reviewerRef);
    const reviewerName = reviewerDoc.exists() ? (reviewerDoc.data().displayName || 'Parent') : 'Parent';

    // Resolve the notification dedupe read up-front (reads-before-writes).
    const notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
      type: 'profile_update_rejected',
      actorId: currentUserUid,
      recipientIds: [reqDoc.data().childId],
      title: 'Profile update rejected',
      body: `Your profile update was rejected by ${reviewerName}${rejectionReason.trim() ? `: ${rejectionReason.trim()}` : ''}.`,
      entityType: 'profile_update_request',
      entityId: requestId,
      dedupeKey: profileUpdateRejectedKey(requestId),
    });

    transaction.update(reqRef, {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUserUid,
      reviewedByName: reviewerName,
      rejectionReason: rejectionReason.trim(),
    });

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Profile update for ${reqDoc.data().childName} was rejected.`,
      visibleTo: [reqDoc.data().childId, currentUserUid],
      timestamp: serverTimestamp(),
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
  });
};

// ---------------------------
// 9. CHILD-TO-CHILD TRANSFERS
// ---------------------------

// Typed domain error used when a canonical wallet document is missing.
// Transfers must never fall back to the legacy users.walletBalance profile field;
// when the single source of truth (families/{familyId}/wallets/{childId}) is absent
// we fail clearly instead of silently using a stale profile value.
export class WalletNotFoundError extends Error {
  readonly code = 'WALLET_NOT_FOUND' as const
  readonly childId: string
  constructor(childId: string) {
    super(`Wallet not found for child "${childId}". Cannot process transfer without a canonical wallet document.`)
    this.name = 'WalletNotFoundError'
    this.childId = childId
  }
}

export const createTransferRequest = async (familyId: string, toChildId: string, amountPence: number, message: string) => {
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");

  const reqRef = doc(collection(db, `families/${familyId}/transfer_requests`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const fromUserRef = doc(db, 'users', currentUserUid);
  const toUserRef = doc(db, 'users', toChildId);
  const fromWalletRef = doc(db, `families/${familyId}/wallets`, currentUserUid);
  const approverIds = await getApproverIds(familyId);

  await runTransaction(db, async (transaction) => {
    const [fromDoc, toDoc, fromWalletDoc] = await Promise.all([
      transaction.get(fromUserRef),
      transaction.get(toUserRef),
      transaction.get(fromWalletRef)
    ]);

    if (!fromDoc.exists() || !toDoc.exists()) throw new Error("User does not exist");
    const fromData = fromDoc.data();
    const toData = toDoc.data();

    if (fromData.role !== 'child' || toData.role !== 'child') throw new Error("Both participants must be children");
    if (fromData.familyId !== familyId || toData.familyId !== familyId) throw new Error("Both participants must be in the same family");
    if (currentUserUid === toChildId) throw new Error("Sender and recipient must differ");
    if (!Number.isInteger(amountPence) || amountPence <= 0) throw new Error("Invalid amount");

    // The canonical wallet document is the single source of truth for balances.
    // Transfers must never fall back to the legacy users.walletBalance profile field.
    if (!fromWalletDoc.exists()) throw new WalletNotFoundError(currentUserUid);
    const fromBalance = fromWalletDoc.data().balance || 0;
    if (fromBalance < amountPence) throw new Error("Insufficient funds");

    // Resolve the notification dedupe read up-front (reads-before-writes).
    let notifPlan = { ref: null, data: null } as Awaited<
      ReturnType<typeof loadNotificationRecipientsInTransaction>
    >;
    if (approverIds.length > 0) {
      notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
        type: 'transfer_requested',
        actorId: currentUserUid,
        recipientIds: approverIds,
        title: 'Transfer approval needed',
        body: `${fromData.displayName} wants to send £${(amountPence / 100).toFixed(2)} to ${toData.displayName}`,
        entityType: 'transfer_request',
        entityId: reqRef.id,
        actionUrl: '/',
        dedupeKey: transferRequestedKey(reqRef.id),
      });
    }

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

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
  });
};

export const approveTransferRequest = async (familyId: string, requestId: string) => {
  const reqRef = doc(db, `families/${familyId}/transfer_requests`, requestId);
  const approvalTxId = doc(collection(db, `families/${familyId}/wallet_transactions`)).id;
  const txOutRef = doc(db, `families/${familyId}/wallet_transactions`, `${approvalTxId}_out`);
  const txInRef = doc(db, `families/${familyId}/wallet_transactions`, `${approvalTxId}_in`);
  const currentUserUid = auth.currentUser?.uid;
  if (!currentUserUid) throw new Error("Not authenticated");
  const currentUserRef = doc(db, 'users', currentUserUid);

  await runTransaction(db, async (transaction) => {
    const reqDoc = await transaction.get(reqRef);
    if (!reqDoc.exists()) throw new Error("Request not found");

    const requestData = reqDoc.data();
    if (requestData.status !== 'pending') throw new Error("Request is not pending");
    if (!Number.isInteger(requestData.amountPence) || requestData.amountPence <= 0) throw new Error("Invalid amount");
    if (requestData.fromChildId === requestData.toChildId) throw new Error("Sender and recipient must differ");

    const senderRef = doc(db, 'users', requestData.fromChildId);
    const recipientRef = doc(db, 'users', requestData.toChildId);

    const fromWalletRef = doc(db, `families/${familyId}/wallets`, requestData.fromChildId);
    const toWalletRef = doc(db, `families/${familyId}/wallets`, requestData.toChildId);

    const [userDoc, senderDoc, recipientDoc, fromWalletDoc, toWalletDoc] = await Promise.all([
      transaction.get(currentUserRef),
      transaction.get(senderRef),
      transaction.get(recipientRef),
      transaction.get(fromWalletRef),
      transaction.get(toWalletRef)
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

    // The canonical wallet documents are the single source of truth. Transfers must
    // never fall back to the legacy users.walletBalance profile field. Fail clearly
    // if either wallet document is missing rather than seeding from a stale profile.
    if (!fromWalletDoc.exists()) throw new WalletNotFoundError(requestData.fromChildId);
    if (!toWalletDoc.exists()) throw new WalletNotFoundError(requestData.toChildId);
    const fromBalance = fromWalletDoc.data().balance || 0;
    const toBalance = toWalletDoc.data().balance || 0;

    // Resolve the notification dedupe reads up-front (reads-before-writes).
    const senderNotifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
      type: 'transfer_approved',
      actorId: currentUserUid,
      recipientIds: [requestData.fromChildId],
      title: 'Transfer approved',
      body: `Your transfer to ${requestData.toChildName} was approved.`,
      entityType: 'transfer_request',
      entityId: requestId,
      actionUrl: '/wallet',
      dedupeKey: transferApprovedSenderKey(requestId),
    });
    const recipientNotifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
      type: 'transfer_approved',
      actorId: currentUserUid,
      recipientIds: [requestData.toChildId],
      title: 'Transfer received',
      body: `You received £${(requestData.amountPence / 100).toFixed(2)} from ${requestData.fromChildName}.`,
      entityType: 'transfer_request',
      entityId: requestId,
      actionUrl: '/wallet',
      dedupeKey: transferApprovedRecipientKey(requestId),
    });

    if (fromBalance < requestData.amountPence) {
      throw new Error("Sender no longer has sufficient funds.");
    }

    transaction.set(fromWalletRef, {
      ...(!fromWalletDoc.exists() ? { createdAt: serverTimestamp(), migratedFromLegacy: true } : {}),
      balance: fromBalance - requestData.amountPence,
      lastTransferTxId: txOutRef.id,
      lastTransferReqId: requestId
    }, { merge: true });

    transaction.set(toWalletRef, {
      ...(!toWalletDoc.exists() ? { createdAt: serverTimestamp(), migratedFromLegacy: true } : {}),
      balance: toBalance + requestData.amountPence,
      lastTransferTxId: txInRef.id,
      lastTransferReqId: requestId
    }, { merge: true });

    transaction.update(reqRef, {
      ...transferApprovalRequestUpdate(approvalTxId, currentUserUid, userData.displayName || 'Parent', serverTimestamp()),
      effectSnapshot: effectSnapshot({ entityType: 'transfer_request', familyId, actorId: currentUserUid, childId: requestData.fromChildId, counterpartyChildId: requestData.toChildId, sourceRequestId: requestId, walletDeltaPence: -requestData.amountPence, counterpartyWalletDeltaPence: requestData.amountPence }),
    });

    const commonTxData = {
      amountPence: requestData.amountPence,
      transferRequestId: requestId,
      approvalTxId: approvalTxId,
      createdAt: serverTimestamp(),
      parentRef: currentUserUid,
      note: requestData.message || "",
      familyId,
      sourceId: requestId,
      status: 'completed',
      actorId: currentUserUid,
    };

    transaction.set(txOutRef, {
      ...commonTxData,
      type: 'transfer_out',
      childId: requestData.fromChildId,
      counterpartyChildId: requestData.toChildId,
      amountPence: -requestData.amountPence,
      description: `Sent to ${requestData.toChildName}`,
      effectSnapshot: effectSnapshot({ entityType: 'transfer_request', familyId, actorId: currentUserUid, childId: requestData.fromChildId, counterpartyChildId: requestData.toChildId, sourceRequestId: requestId, walletDeltaPence: -requestData.amountPence, counterpartyWalletDeltaPence: requestData.amountPence })
    });

    transaction.set(txInRef, {
      ...commonTxData,
      type: 'transfer_in',
      childId: requestData.toChildId,
      counterpartyChildId: requestData.fromChildId,
      amountPence: requestData.amountPence,
      description: `Received from ${requestData.fromChildName}`,
      effectSnapshot: effectSnapshot({ entityType: 'transfer_request', familyId, actorId: currentUserUid, childId: requestData.fromChildId, counterpartyChildId: requestData.toChildId, sourceRequestId: requestId, walletDeltaPence: -requestData.amountPence, counterpartyWalletDeltaPence: requestData.amountPence })
    });

    const feedSenderRef = doc(collection(db, `families/${familyId}/feed`));
    const feedRecipientRef = doc(collection(db, `families/${familyId}/feed`));

    transaction.set(feedSenderRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Your transfer to ${requestData.toChildName} was approved.`,
      visibleTo: [requestData.fromChildId],
      timestamp: serverTimestamp()
    });

    transaction.set(feedRecipientRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `You received £${(requestData.amountPence / 100).toFixed(2)} from ${requestData.fromChildName}.`,
      visibleTo: [requestData.toChildId],
      timestamp: serverTimestamp()
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, senderNotifPlan);
    applyNotificationWrites(transaction, recipientNotifPlan);
  });
};

export const rejectTransferRequest = async (familyId: string, requestId: string, rejectionReason: string) => {
  if (!rejectionReason.trim()) throw new Error('Rejection reason is required');
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

    // Resolve the notification dedupe read up-front (reads-before-writes).
    const notifPlan = await loadNotificationRecipientsInTransaction(transaction, familyId, {
      type: 'transfer_rejected',
      actorId: currentUserUid,
      recipientIds: [reqDoc.data().fromChildId],
      title: 'Transfer rejected',
      body: `Your transfer to ${reqDoc.data().toChildName} was rejected${rejectionReason.trim() ? `: ${rejectionReason.trim()}` : ''}.`,
      entityType: 'transfer_request',
      entityId: requestId,
      actionUrl: '/wallet',
      dedupeKey: transferRejectedKey(requestId),
    });

    transaction.update(reqRef, {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUserUid,
      reviewedByName: userData.displayName,
      rejectionReason: rejectionReason.trim()
    });

    transaction.set(feedRef, {
      actorId: currentUserUid,
      actorName: userData.displayName,
      type: 'custom',
      text: `Your transfer to ${reqDoc.data().toChildName} was rejected.`,
      visibleTo: [reqDoc.data().fromChildId],
      timestamp: serverTimestamp()
    });

    // Write stage performs ZERO reads.
    applyNotificationWrites(transaction, notifPlan);
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
    const initialStatus = toData.role === 'parent' || toData.role === 'owner' ? 'pending' : 'pending_acceptance';

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
      entityType: 'money_request',
      entityId: reqRef.id,
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
      entityType: 'money_request',
      entityId: requestId,
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
      entityType: 'money_request',
      entityId: requestId,
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
    if (reqData.status !== 'pending' && reqData.status !== 'pending_acceptance') throw new Error("Request is not pending approval");

    const requesterWalletRef = doc(db, `families/${familyId}/wallets`, reqData.requesterId);

    // If request was to parent
    const requestedFromRef = doc(db, 'users', reqData.requestedFromId);
    const requesterUserRef = doc(db, 'users', reqData.requesterId);
    const requestedFromWalletRef = doc(db, `families/${familyId}/wallets`, reqData.requestedFromId);
    const [requestedFromDoc, requesterUserDoc, requesterWalletDoc, requestedFromWalletDoc] = await Promise.all([
      transaction.get(requestedFromRef),
      transaction.get(requesterUserRef),
      transaction.get(requesterWalletRef),
      transaction.get(requestedFromWalletRef),
    ]);
    const isFromParent = requestedFromDoc.data()?.role === 'parent' || requestedFromDoc.data()?.role === 'owner';
    const requestEffect = isFromParent
      ? effectSnapshot({ entityType: 'money_request', familyId, actorId: currentUserUid, childId: reqData.requesterId, sourceRequestId: requestId, walletDeltaPence: reqData.amountPence })
      : effectSnapshot({ entityType: 'money_request', familyId, actorId: currentUserUid, childId: reqData.requestedFromId, counterpartyChildId: reqData.requesterId, sourceRequestId: requestId, walletDeltaPence: -reqData.amountPence, counterpartyWalletDeltaPence: reqData.amountPence });

    if (!requesterUserDoc.exists()) throw new Error("User not found");
    const reqBalance = await ensureWalletDocument(transaction, familyId, reqData.requesterId, requesterUserDoc, requesterWalletDoc);

    if (isFromParent) {
      transaction.set(requesterWalletRef, {
        ...(!requesterWalletDoc.exists() ? { createdAt: serverTimestamp(), migratedFromLegacy: true } : {}),
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
        familyId,
        sourceId: requestId,
        actorId: currentUserUid,
        status: 'completed',
        effectSnapshot: requestEffect,
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp()
      });
    } else {
      const fromWalletRef = requestedFromWalletRef;
      if (!requestedFromDoc.exists()) throw new Error("User not found");
      const fromBalance = await ensureWalletDocument(transaction, familyId, reqData.requestedFromId, requestedFromDoc, requestedFromWalletDoc);

      if (fromBalance < reqData.amountPence) throw new Error("Insufficient funds");

      transaction.set(fromWalletRef, {
        ...(!requestedFromWalletDoc.exists() ? { createdAt: serverTimestamp(), migratedFromLegacy: true } : {}),
        balance: fromBalance - reqData.amountPence,
        lastTransferTxId: txOutRef.id,
        lastTransferReqId: requestId,
      }, { merge: true });

      transaction.set(requesterWalletRef, {
        ...(!requesterWalletDoc.exists() ? { createdAt: serverTimestamp(), migratedFromLegacy: true } : {}),
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
        note: reqData.message || "",
        familyId,
        sourceId: requestId,
        actorId: currentUserUid,
        status: 'completed',
      };

      transaction.set(txOutRef, {
        ...commonTxData,
        type: 'transfer_out',
        childId: reqData.requestedFromId,
        counterpartyChildId: reqData.requesterId,
        amountPence: -reqData.amountPence,
        effectSnapshot: requestEffect
      });

      transaction.set(txInRef, {
        ...commonTxData,
        type: 'transfer_in',
        childId: reqData.requesterId,
        counterpartyChildId: reqData.requestedFromId,
        amountPence: reqData.amountPence,
        effectSnapshot: requestEffect
      });
    }

    transaction.update(reqRef, {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUserUid,
      reviewedByName: userData?.displayName || 'Parent',
      paymentTransferId: approvalTxId,
      effectSnapshot: requestEffect
    });

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Money request approved.`,
      entityType: 'money_request',
      entityId: requestId,
      visibleTo: [reqData.requesterId, reqData.requestedFromId],
      timestamp: serverTimestamp()
    });
  });
};

export const rejectMoneyRequest = async (familyId: string, requestId: string, rejectionReason: string) => {
  if (!rejectionReason.trim()) throw new Error('Rejection reason is required');
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
    if (reqDoc.data().status !== 'pending' && reqDoc.data().status !== 'pending_acceptance') throw new Error('Request is not pending approval');

    transaction.update(reqRef, {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUserUid,
      reviewedByName: userData?.displayName || 'Parent',
      rejectionReason: rejectionReason.trim()
    });

    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: currentUserUid,
      type: 'custom',
      text: `Money request rejected.`,
      entityType: 'money_request',
      entityId: requestId,
      visibleTo: [reqDoc.data().requesterId, reqDoc.data().requestedFromId],
      timestamp: serverTimestamp()
    });
  });
};

/**
 * Maps a thrown approval/rejection error to a friendly, user-safe message.
 * Raw Firebase error codes (e.g. `permission-denied`) and server messages must
 * never be rendered to end users in production. The original error is preserved
 * on the returned object for development-only logging.
 */
export type MappedApprovalError = { message: string; code?: string; raw?: unknown };

export const mapApprovalError = (err: unknown): MappedApprovalError => {
  const code = (err as any)?.code;
  const message: string = (err as any)?.message || '';

  if (code === 'permission-denied' || /permission-denied|Missing or insufficient permissions/i.test(message)) {
    return { message: "You no longer have permission to manage this request.", code: 'permission-denied', raw: err };
  }
  if (/not pending approval|Request cannot|Request is not pending/i.test(message)) {
    return { message: "This request has already been decided.", code, raw: err };
  }
  if (/Request not found/i.test(message)) {
    return { message: "The request changed while you were reviewing it. Please refresh and try again.", code, raw: err };
  }
  if (/Unauthorized/i.test(message)) {
    return { message: "You no longer have permission to manage this request.", code, raw: err };
  }
  if (/Rejection reason is required/i.test(message)) {
    return { message: "Please provide a reason for rejecting this request.", code, raw: err };
  }
  return { message: "We couldn’t reject this request. Please try again.", code, raw: err };
};

export type PendingApprovalKind = 'task' | 'transfer' | 'money_request' | 'petbox' | 'goal';

const pendingApprovalContract: Record<PendingApprovalKind, { collectionName: string; pendingStatuses: string[]; actorField: string }> = {
  task: { collectionName: 'task_completions', pendingStatuses: ['pending_approval'], actorField: 'assigneeId' },
  transfer: { collectionName: 'transfer_requests', pendingStatuses: ['pending'], actorField: 'fromChildId' },
  money_request: { collectionName: 'money_requests', pendingStatuses: ['pending', 'pending_acceptance'], actorField: 'requesterId' },
  petbox: { collectionName: 'petbox_requests', pendingStatuses: ['pending'], actorField: 'childId' },
  goal: { collectionName: 'goal_requests', pendingStatuses: ['pending'], actorField: 'childId' },
};

/** Cancel an uneffected request. This transition deliberately performs no balance write. */
export const cancelPendingApproval = async (familyId: string, kind: PendingApprovalKind, requestId: string) => {
  const actorId = auth.currentUser?.uid;
  if (!actorId) throw new Error('Not authenticated');
  const contract = pendingApprovalContract[kind];
  const requestRef = doc(db, `families/${familyId}/${contract.collectionName}`, requestId);
  const actorRef = doc(db, 'users', actorId);

  await runTransaction(db, async (transaction) => {
    const [requestDoc, actorDoc] = await Promise.all([transaction.get(requestRef), transaction.get(actorRef)]);
    if (!requestDoc.exists()) throw new Error('Request not found');
    const request = requestDoc.data();
    if (!contract.pendingStatuses.includes(request.status)) throw new Error('Request is not pending');
    const actor = actorDoc.exists() ? actorDoc.data() : null;
    const isFamilyReviewer = actor?.familyId === familyId && (actor.role === 'parent' || actor.role === 'owner');
    if (request[contract.actorField] !== actorId && !isFamilyReviewer) throw new Error('Only the request originator or a family parent/owner can cancel it');
    transaction.update(requestRef, { status: 'cancelled', cancelledBy: actorId, cancelledAt: serverTimestamp() });
  });
};

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { setDoc, getDoc, doc, updateDoc, deleteDoc, collection, addDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-owner-audit',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    // Setup Family
    await setDoc(doc(db, 'families', 'fam-1'), { name: 'Audit Family', debtLimitPence: -5000 });
    await setDoc(doc(db, 'families', 'fam-2'), { name: 'Other Family' });

    // Setup Owner
    await setDoc(doc(db, 'users', 'owner-1'), {
      familyId: 'fam-1', role: 'owner', displayName: 'Owner'
    });

    // Setup Parent
    await setDoc(doc(db, 'users', 'parent-1'), {
      familyId: 'fam-1', role: 'parent', displayName: 'Parent'
    });

    // Setup Child
    await setDoc(doc(db, 'users', 'child-1'), {
      familyId: 'fam-1', role: 'child', displayName: 'Child',
      rewardPoints: 100, lifetimeXP: 100, walletBalance: 500
    });

    // Setup Wrong Family Owner
    await setDoc(doc(db, 'users', 'wrong-owner-1'), {
      familyId: 'fam-2', role: 'owner', displayName: 'Wrong Owner'
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const getDb = (uid: string | null) => {
  if (!uid) return testEnv.unauthenticatedContext().firestore();
  return testEnv.authenticatedContext(uid).firestore();
};

describe('Auth / Family Permissions', () => {
  it('allows owner to load family document', async () => {
    const db = getDb('owner-1');
    await expect(getDoc(doc(db, 'families', 'fam-1'))).resolves.not.toThrow();
  });

  it('denies wrong-family loading family document', async () => {
    await expect(getDoc(doc(getDb('wrong-owner-1'), 'families', 'fam-1'))).rejects.toThrow();
  });

  it('owner cannot modify another family', async () => {
    const db = getDb('owner-1');
    await expect(updateDoc(doc(db, 'families', 'fam-2'), { debtLimitPence: -1000 })).rejects.toThrow();
  });

  it('owner cannot alter child role', async () => {
    const db = getDb('owner-1');
    await expect(updateDoc(doc(db, 'users', 'child-1'), { role: 'parent' })).rejects.toThrow();
  });

  it('owner cannot alter child familyId', async () => {
    const db = getDb('owner-1');
    await expect(updateDoc(doc(db, 'users', 'child-1'), { familyId: 'fam-2' })).rejects.toThrow();
  });

  it('allows owner to approve a join request', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'new-user'), {
        uid: 'new-user',
        role: 'parent',
        displayName: 'New User'
      });
      await setDoc(doc(context.firestore(), 'families', 'fam-1', 'join_requests', 'req-1'), {
        uid: 'new-user',
        status: 'pending',
        displayName: 'New User'
      });
    });
    
    const db = getDb('owner-1');
    const batch = writeBatch(db);
    batch.update(doc(db, 'families', 'fam-1', 'join_requests', 'req-1'), {
      status: 'approved',
      assignedRole: 'parent',
      reviewedBy: 'owner-1',
      reviewedByName: 'Owner',
      reviewedAt: serverTimestamp()
    });
    batch.update(doc(db, 'users', 'new-user'), {
      familyId: 'fam-1',
      joinRequestId: 'req-1',
      role: 'parent',
      displayName: 'New User',
      uid: 'new-user',
      avatarUrl: '',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: serverTimestamp()
    });
    batch.set(doc(db, 'families', 'fam-1', 'feed', 'join_req-1'), {
      actorId: 'owner-1',
      createdAt: serverTimestamp()
    });
    await expect(batch.commit()).resolves.not.toThrow();
  });

  it('owner cannot approve an already completed request', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'new-user'), {
        uid: 'new-user',
        role: 'parent',
        displayName: 'New User'
      });
      await setDoc(doc(context.firestore(), 'families', 'fam-1', 'join_requests', 'req-1'), {
        uid: 'new-user',
        status: 'approved', // already approved
        displayName: 'New User'
      });
    });
    
    const db = getDb('owner-1');
    const batch = writeBatch(db);
    batch.update(doc(db, 'families', 'fam-1', 'join_requests', 'req-1'), {
      status: 'approved',
      assignedRole: 'parent',
      reviewedBy: 'owner-1',
      reviewedByName: 'Owner',
      reviewedAt: serverTimestamp()
    });
    // omitting the rest of the batch as it will fail on join_requests update anyway
    await expect(batch.commit()).rejects.toThrow();
  });

  it('owner cannot forge reviewedBy', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'new-user'), { uid: 'new-user', role: 'parent', displayName: 'New User' });
      await setDoc(doc(context.firestore(), 'families', 'fam-1', 'join_requests', 'req-1'), { uid: 'new-user', status: 'pending', displayName: 'New User' });
    });
    
    const db = getDb('owner-1');
    const batch = writeBatch(db);
    batch.update(doc(db, 'families', 'fam-1', 'join_requests', 'req-1'), {
      status: 'approved',
      assignedRole: 'parent',
      reviewedBy: 'parent-1', // forged
      reviewedByName: 'Owner',
      reviewedAt: serverTimestamp()
    });
    await expect(batch.commit()).rejects.toThrow();
  });
});

describe('Tasks Permissions', () => {
  it('allows owner to create a task', async () => {
    const db = getDb('owner-1');
    await expect(setDoc(doc(db, 'families', 'fam-1', 'tasks', 'task-1'), {
      title: 'Real Task',
      description: 'Clean room',
      pointsReward: 50,
      type: 'daily',
      customDays: [],
      requiresApproval: true,
      assigneeId: null,
      isActive: true,
      createdAt: serverTimestamp()
    })).resolves.not.toThrow();
  });
});

describe('Wallet Permissions', () => {
  it('owner cannot arbitrarily set wallet balance', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'families', 'fam-1', 'wallets', 'child-1'), { balance: 500 });
    });
    const db = getDb('owner-1');
    await expect(updateDoc(doc(db, 'families', 'fam-1', 'wallets', 'child-1'), {
      balance: 1000
    })).rejects.toThrow(); // Fails because there is no matching ledger entry
  });

  it('owner can create standalone wallet ledger (due to circular dependency limit in rules)', async () => {
    const db = getDb('owner-1');
    await expect(setDoc(doc(db, 'families', 'fam-1', 'wallet_transactions', 'tx-1'), {
      childId: 'child-1',
      amount: 100,
      type: 'deposit',
      parentRef: 'owner-1',
      createdAt: serverTimestamp()
    })).resolves.not.toThrow(); // Succeeds because bidirectional getAfter limits prevent strict rejection here. Real balance mutation strictly requires this ledger.
  });

  it('owner cannot update immutable ledger', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'families', 'fam-1', 'wallet_transactions', 'tx-1'), {
        childId: 'child-1', amount: 100, type: 'deposit'
      });
    });
    const db = getDb('owner-1');
    await expect(updateDoc(doc(db, 'families', 'fam-1', 'wallet_transactions', 'tx-1'), {
      amount: 200
    })).rejects.toThrow();
  });

  it('owner cannot delete immutable ledger', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'families', 'fam-1', 'wallet_transactions', 'tx-1'), {
        childId: 'child-1', amount: 100, type: 'deposit'
      });
    });
    const db = getDb('owner-1');
    await expect(deleteDoc(doc(db, 'families', 'fam-1', 'wallet_transactions', 'tx-1'))).rejects.toThrow();
  });

  it('owner cannot bypass debt limit', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'families', 'fam-1', 'wallets', 'child-1'), { balance: 0 });
    });
    const db = getDb('owner-1');
    const batch = writeBatch(db);
    batch.set(doc(db, 'families', 'fam-1', 'wallet_transactions', 'tx-1'), {
      childId: 'child-1',
      amount: -6000, // Exceeds the -5000 debt limit
      type: 'withdrawal',
      parentRef: 'owner-1',
      createdAt: serverTimestamp()
    });
    batch.update(doc(db, 'families', 'fam-1', 'wallets', 'child-1'), {
      balance: -6000,
      lastManualTxId: 'tx-1'
    });
    await expect(batch.commit()).rejects.toThrow();
  });
});

describe('Reversals Permissions', () => {
  it('owner cannot create arbitrary reversal', async () => {
    const db = getDb('owner-1');
    await expect(setDoc(doc(db, 'families', 'fam-1', 'reversals', 'rev-1'), {
      familyId: 'fam-1',
      actorId: 'owner-1',
      actionType: 'task_completion',
      createdAt: serverTimestamp()
    })).rejects.toThrow(); // Denied due to missing exact schema matching
  });

  it('owner cannot duplicate a refund/reversal', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'families', 'fam-1', 'reversals', 'task_completion__comp-1'), {
        status: 'completed'
      });
    });
    const db = getDb('owner-1');
    await expect(setDoc(doc(db, 'families', 'fam-1', 'reversals', 'task_completion__comp-1'), {
      familyId: 'fam-1',
      sourceKind: 'task_completion',
      sourceId: 'comp-1',
      reversalId: 'task_completion__comp-1',
      actorId: 'owner-1',
      actorName: 'Owner',
      reason: 'mistake',
      status: 'completed',
      originalEffectSnapshot: { childId: 'child-1', pointsDelta: 10 },
      inverseEffectSnapshot: { schemaVersion: 1, entityType: 'reversal', familyId: 'fam-1', actorId: 'owner-1', childId: 'child-1', pointsDelta: -10, xpAdjustment: 0 },
      xpAdjustment: 0,
      xpReversed: false,
      completedAt: serverTimestamp()
    })).rejects.toThrow(); // Reversals with the same ID cannot be overwritten
  });
});

describe('Pet Box / Fund Permissions', () => {
  it('owner cannot add unrelated fields to strict documents', async () => {
    const db = getDb('owner-1');
    const batch = writeBatch(db);
    batch.set(doc(db, 'families', 'fam-1', 'fund_transactions', 'tx-1'), {
      familyId: 'fam-1',
      fundId: 'fund-1',
      amount: 100,
      type: 'expense',
      createdAt: serverTimestamp(),
      createdBy: 'owner-1',
      actorId: 'owner-1',
      sourceId: 'tx-1',
      maliciousField: 'hacked' // THIS SHOULD CAUSE IT TO REJECT
    });
    await expect(batch.commit()).rejects.toThrow();
  });
});

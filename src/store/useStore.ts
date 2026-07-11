import { create } from 'zustand';
import { collection, doc, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface AppState {
  currentUser: any | null;
  familyMembers: any[];
  tasks: any[];
  taskCompletions: any[];
  rewards: any[];
  feed: any[];
  walletTransactions: any[];
  loading: boolean;
  error: string | null;
  init: (uid: string, familyId: string) => void;
}

export const useStore = create<AppState>((set) => ({
  currentUser: null,
  familyMembers: [],
  tasks: [],
  taskCompletions: [],
  rewards: [],
  feed: [],
  walletTransactions: [],
  loading: true,
  error: null,

  init: (uid, familyId) => {
    set({ loading: true });
    try {
      // 1. Current User
      onSnapshot(doc(db, 'users', uid), (doc) => {
        set({ currentUser: { id: doc.id, ...doc.data() } });
      });

      // 2. Family Members
      onSnapshot(query(collection(db, 'users'), where('familyId', '==', familyId)), (snap) => {
        set({ familyMembers: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      });

      // 3. Tasks
      onSnapshot(collection(db, `families/${familyId}/tasks`), (snap) => {
        set({ tasks: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      });

      // 4. Task Completions
      onSnapshot(collection(db, `families/${familyId}/task_completions`), (snap) => {
        set({ taskCompletions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      });

      // 5. Rewards
      onSnapshot(collection(db, `families/${familyId}/rewards`), (snap) => {
        set({ rewards: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      });

      // 6. Feed
      onSnapshot(query(collection(db, `families/${familyId}/feed`), orderBy('timestamp', 'desc')), (snap) => {
        set({ feed: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      });

      // 7. Wallet Transactions (for current user)
      onSnapshot(query(collection(db, `families/${familyId}/wallet_transactions`), where('userId', '==', uid)), (snap) => {
        set({ walletTransactions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      });

      set({ loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  }
}));

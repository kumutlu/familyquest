import { create } from 'zustand';
import { collection, doc, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../lib/firebase';

interface AppState {
  authUser: any | null;
  currentUser: any | null;
  familyData: any | null;
  familyMembers: any[];
  tasks: any[];
  taskCompletions: any[];
  rewards: any[];
  feed: any[];
  walletTransactions: any[];
  behaviourEvents: any[];
  challenges: any[];
  loading: boolean;
  error: string | null;
  initAuth: () => void;
  loadFamilyData: (uid: string, familyId: string) => () => void;
}

export const useStore = create<AppState>((set, get) => ({
  authUser: undefined, // undefined means auth state is still loading
  currentUser: null,
  familyData: null,
  familyMembers: [],
  tasks: [],
  taskCompletions: [],
  rewards: [],
  feed: [],
  walletTransactions: [],
  behaviourEvents: [],
  challenges: [],
  loading: true,
  error: null,

  initAuth: () => {
    onAuthStateChanged(auth, (user) => {
      set({ authUser: user });
      if (!user) {
        set({ currentUser: null, loading: false });
      } else {
        // Fetch user doc
        onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
          if (docSnap.exists()) {
            const userData: any = { id: docSnap.id, ...docSnap.data() };
            set({ currentUser: userData, loading: false });
            
            // If they have a family, load family data
            if (userData.familyId) {
              get().loadFamilyData(userData.id, userData.familyId);
            }
          } else {
            set({ currentUser: null, loading: false });
          }
        });
      }
    });
  },

  loadFamilyData: (uid, familyId) => {
    set({ loading: true });
    
    const unsubs: any[] = [];
    
    try {
      unsubs.push(onSnapshot(doc(db, 'families', familyId), (snap) => {
        set({ familyData: snap.exists() ? { id: snap.id, ...snap.data() } : null });
      }));

      unsubs.push(onSnapshot(query(collection(db, 'users'), where('familyId', '==', familyId)), (snap) => {
        set({ familyMembers: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }));

      unsubs.push(onSnapshot(collection(db, `families/${familyId}/tasks`), (snap) => {
        set({ tasks: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }));

      unsubs.push(onSnapshot(collection(db, `families/${familyId}/task_completions`), (snap) => {
        set({ taskCompletions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }));

      unsubs.push(onSnapshot(collection(db, `families/${familyId}/rewards`), (snap) => {
        set({ rewards: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }));

      unsubs.push(onSnapshot(query(collection(db, `families/${familyId}/feed`), orderBy('timestamp', 'desc')), (snap) => {
        set({ feed: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }));

      unsubs.push(onSnapshot(query(collection(db, `families/${familyId}/wallet_transactions`), where('userId', '==', uid)), (snap) => {
        set({ walletTransactions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }));

      unsubs.push(onSnapshot(query(collection(db, `families/${familyId}/behaviour_events`), orderBy('timestamp', 'desc')), (snap) => {
        set({ behaviourEvents: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }));

      unsubs.push(onSnapshot(query(collection(db, `families/${familyId}/challenges`), orderBy('createdAt', 'desc')), (snap) => {
        set({ challenges: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }));

      set({ loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
    
    return () => unsubs.forEach(u => u());
  }
}));

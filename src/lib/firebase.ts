import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  // Placeholder configuration for the MVP. Replace with actual Firebase project config.
  apiKey: "AIzaSy_MOCK_API_KEY",
  authDomain: "familiya-gamification-mock.firebaseapp.com",
  projectId: "familiya-gamification-mock",
  storageBucket: "familiya-gamification-mock.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:mock123"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

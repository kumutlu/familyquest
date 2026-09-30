import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { initializeApp as initClientApp } from 'firebase/app';
import { getAuth as getClientAuth, connectAuthEmulator, sendPasswordResetEmail } from 'firebase/auth';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';

const projectId = 'familyquest-beta-402cb';
const email = process.env.RESET_EMAIL;
const oldPassword = process.env.RESET_PASSWORD;

if (!email || !oldPassword) throw new Error('RESET_EMAIL_AND_PASSWORD_REQUIRED');

if (getApps().length === 0) {
  initializeApp({ projectId });
}

const db = getFirestore();
const adminAuth = getAdminAuth();

async function seedPasswordReset() {
  const uid = `reset-${Date.now()}`;
  const familyId = `fam-${Date.now()}`;

  await adminAuth.createUser({ uid, email, emailVerified: true, password: oldPassword, displayName: 'Reset Owner' });

  const batch = db.batch();
  batch.set(db.doc(`families/${familyId}`), { name: 'Reset Family', inviteCode: 'RST999', currency: '£', debtLimit: 0, createdAt: Timestamp.now() });
  batch.set(db.doc(`users/${uid}`), { familyId, role: 'owner', displayName: 'Reset Owner' });
  await batch.commit();

  const clientApp = initClientApp({ apiKey: 'fake-key', authDomain: 'localhost', projectId });
  const clientAuth = getClientAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  await sendPasswordResetEmail(clientAuth, email);
}

void seedPasswordReset();

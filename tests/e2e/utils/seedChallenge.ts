import { db } from './seed';
import { Timestamp } from 'firebase-admin/firestore';

// Seeds a single active, already-completable Family Challenge into the emulator
// so the challenge-claim e2e flow can be exercised end-to-end. Run via execSync
// from the e2e spec (after the base family seed).
async function main() {
  await db.doc('families/test-fam/challenges/challenge-1').set({
    isActive: true,
    title: 'Weekly Warriors',
    description: 'Complete the weekly family goal together.',
    rewardPoints: 25,
    targetXP: 100,
    startXP: 0,
    createdAt: Timestamp.now(),
  });
  console.log('challenge seeded');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

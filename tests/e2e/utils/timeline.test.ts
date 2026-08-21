import { describe, expect, it } from 'vitest';
import { isFirestoreTransportError } from './timeline';

describe('Firestore transport classification', () => {
  it('separates SDK unavailable connectivity from functional application errors', () => {
    expect(isFirestoreTransportError("@firebase/firestore: Could not reach Cloud Firestore backend. Most recent error: FirebaseError: [code=unavailable]"))
      .toBe(true);
  });

  it('does not hide permission or application Firestore failures', () => {
    expect(isFirestoreTransportError('FirebaseError: [code=permission-denied]: Missing or insufficient permissions.'))
      .toBe(false);
  });
});

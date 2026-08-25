import { createHash, randomBytes } from 'node:crypto';
import type { Timestamp } from 'firebase-admin/firestore';

export type AdultRole = 'parent' | 'adult';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AdultInvitationRecord = {
  version: 2;
  familyId: string;
  intendedRole: AdultRole;
  status: 'active' | 'accepted' | 'revoked';
  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  acceptedBy?: string;
  acceptedAt?: Timestamp;
  revokedBy?: string;
  revokedAt?: Timestamp;
  clientReqId: string;
};

export function generateAdultInvitationToken(
  bytes: () => Buffer = () => randomBytes(32),
): string {
  const tokenBytes = bytes();
  if (tokenBytes.length !== 32) {
    throw new Error('INVALID_INVITATION_TOKEN_BYTES');
  }
  return tokenBytes.toString('base64url');
}

function validateAdultInvitationToken(token: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('INVALID_INVITATION_TOKEN');
  }

  const decoded = Buffer.from(token, 'base64url');
  if (decoded.length !== 32 || decoded.toString('base64url') !== token) {
    throw new Error('INVALID_INVITATION_TOKEN');
  }
  return decoded;
}

export function hashAdultInvitationToken(token: string): string {
  validateAdultInvitationToken(token);
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function validateAdultRole(value: unknown): AdultRole {
  if (value === 'parent' || value === 'adult') {
    return value;
  }
  throw new Error('INVALID_INTENDED_ROLE');
}

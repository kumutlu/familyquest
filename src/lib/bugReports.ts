import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { FAMILYQUEST_BUILD } from '../buildInfo';
import { useStore } from '../store/useStore';

export const BUG_REPORT_CATEGORIES = [
  'broken',
  'visual',
  'points_rewards',
  'tasks',
  'wallet',
  'family',
  'other',
] as const;

export type BugReportCategory = (typeof BUG_REPORT_CATEGORIES)[number];

export interface TechnicalContext {
  releaseSha: string;
  releaseVersion: string;
  route: string;
  theme: string;
  locale: string;
  viewport: {
    width: number;
    height: number;
  };
  standalone: boolean;
  online: boolean;
  userAgent: string;
  swControlled?: boolean;
}

/**
 * Collects safe, strictly allow-listed technical debugging metadata from the
 * browser environment. Never touches private messages, tokens, balances or store dumps.
 */
export function collectTechnicalContext(
  theme?: string,
  locale?: string,
  route?: string,
): TechnicalContext {
  const isClient = typeof window !== 'undefined';

  const standalone = isClient
    ? Boolean(
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
          (window.navigator as any)?.standalone === true,
      )
    : false;

  return {
    releaseSha: FAMILYQUEST_BUILD.sha,
    releaseVersion: FAMILYQUEST_BUILD.version,
    route: route || (isClient ? window.location.pathname : '/'),
    theme: theme || (isClient && document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
    locale: locale || 'en',
    viewport: {
      width: isClient ? window.innerWidth : 0,
      height: isClient ? window.innerHeight : 0,
    },
    standalone,
    online: isClient ? window.navigator.onLine !== false : true,
    userAgent: isClient ? window.navigator.userAgent : '',
    swControlled: isClient ? Boolean(window.navigator.serviceWorker?.controller) : false,
  };
}

export interface BugReportInput {
  category: BugReportCategory;
  description: string;
  technicalContext?: TechnicalContext;
}

/**
 * Submits a bug report from an authenticated family member.
 * Writes to the write-only root collection `/bug_reports`.
 */
export async function submitBugReport(input: BugReportInput): Promise<{ id: string }> {
  const { currentUser } = useStore.getState();
  if (!currentUser?.id) {
    throw new Error('You must be signed in to submit a report.');
  }

  const trimmed = input.description.trim();
  if (trimmed.length < 3) {
    throw new Error('Please enter at least 3 characters.');
  }
  if (trimmed.length > 2000) {
    throw new Error('Description is too long (maximum 2000 characters).');
  }

  const technicalContext = input.technicalContext || collectTechnicalContext();

  const reportData = {
    familyId: currentUser.familyId || '',
    reporterUserId: currentUser.id,
    reporterRole: currentUser.role || 'child',
    category: input.category,
    description: trimmed,
    technicalContext,
    status: 'open',
    createdAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(db, 'bug_reports'), reportData);
  return { id: docRef.id };
}

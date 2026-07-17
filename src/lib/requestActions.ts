/**
 * Request action handlers
 * ------------------------
 * Maps a request category to the API calls needed to approve / reject / cancel
 * it. Centralising this here means screens never repeat the same switch
 * statement over request types.
 */

import {
  approveTaskCompletion,
  rejectTaskCompletion,
  approveTransferRequest,
  rejectTransferRequest,
  approveMoneyRequest,
  rejectMoneyRequest,
  acceptMoneyRequest,
  approvePetBoxDonation,
  rejectPetBoxDonation,
  approveProfileUpdateRequest,
  rejectProfileUpdateRequest,
  cancelPendingApproval,
  type PendingApprovalKind,
} from './api';
import type { RequestCategory } from './requestModel';

export interface RequestActionHandlers {
  approve?: (familyId: string, id: string, comment?: string) => Promise<void>;
  reject?: (familyId: string, id: string, comment: string) => Promise<void>;
  cancel?: (familyId: string, id: string) => Promise<void>;
  accept?: (familyId: string, id: string) => Promise<void>;
}

const cancelableKinds: RequestCategory[] = ['task', 'transfer', 'money_request', 'petbox'];

function cancelHandler(category: RequestCategory): RequestActionHandlers['cancel'] {
  if (!cancelableKinds.includes(category)) return undefined;
  return (familyId, id) => cancelPendingApproval(familyId, category as PendingApprovalKind, id);
}

const handlers: Record<RequestCategory, RequestActionHandlers> = {
  task: {
    approve: (familyId, id, comment) => approveTaskCompletion(familyId, id, comment ?? ''),
    reject: (familyId, id, comment) => rejectTaskCompletion(familyId, id, comment),
    cancel: cancelHandler('task'),
  },
  transfer: {
    approve: (familyId, id) => approveTransferRequest(familyId, id),
    reject: (familyId, id, comment) => rejectTransferRequest(familyId, id, comment),
    cancel: cancelHandler('transfer'),
  },
  money_request: {
    approve: (familyId, id) => approveMoneyRequest(familyId, id),
    reject: (familyId, id, comment) => rejectMoneyRequest(familyId, id, comment),
    accept: (familyId, id) => acceptMoneyRequest(familyId, id),
    cancel: cancelHandler('money_request'),
  },
  petbox: {
    approve: (familyId, id) => approvePetBoxDonation(familyId, id),
    reject: (familyId, id, comment) => rejectPetBoxDonation(familyId, id, comment),
    cancel: cancelHandler('petbox'),
  },
  profile_update: {
    approve: (familyId, id) => approveProfileUpdateRequest(familyId, id),
    reject: (familyId, id, comment) => rejectProfileUpdateRequest(familyId, id, comment),
  },
  reward: {},
  join: {},
};

export function getRequestActions(category: RequestCategory): RequestActionHandlers {
  return handlers[category] ?? {};
}

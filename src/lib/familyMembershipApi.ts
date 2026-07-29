import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface FamilyJoinResult {
  familyId: string;
  status: 'pending';
}

export async function requestFamilyJoin(
  familyCode: string,
  clientReqId = crypto.randomUUID(),
): Promise<FamilyJoinResult> {
  const callable = httpsCallable<
    { familyCode: string; clientReqId: string },
    FamilyJoinResult
  >(functions, 'requestFamilyJoin');
  const response = await callable({ familyCode, clientReqId });
  return response.data;
}

export async function regenerateFamilyCode(
  clientReqId = crypto.randomUUID(),
): Promise<{ familyCode: string }> {
  const callable = httpsCallable<
    { clientReqId: string },
    { familyCode: string }
  >(functions, 'regenerateFamilyCode');
  const response = await callable({ clientReqId });
  return response.data;
}

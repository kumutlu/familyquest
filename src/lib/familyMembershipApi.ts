import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { requireCurrentFamilyAuthority } from '../auth/clientFamilyAuthority';

export interface FamilyJoinResult {
  familyId: string;
  status: 'pending';
}

export async function requestFamilyJoin(
  familyCode: string,
  clientReqId: string = crypto.randomUUID(),
): Promise<FamilyJoinResult> {
  await requireCurrentFamilyAuthority();
  const callable = httpsCallable<
    { familyCode: string; clientReqId: string },
    FamilyJoinResult
  >(functions, 'requestFamilyJoin');
  const response = await callable({ familyCode, clientReqId });
  return response.data;
}

export async function regenerateFamilyCode(
  clientReqId: string = crypto.randomUUID(),
): Promise<{ familyCode: string }> {
  const callable = httpsCallable<
    { clientReqId: string },
    { familyCode: string }
  >(functions, 'regenerateFamilyCode');
  const response = await callable({ clientReqId });
  return response.data;
}

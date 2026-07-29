import { isChildRole, isOwnerRole } from './roles';

export interface FamilySetupState {
  appReady: boolean;
  familyLoading: boolean;
  familyData: any | null;
  familyMembers: any[];
  currentUser: any | null;
  bootstrapStatus: Record<string, string>;
}

export function shouldShowFamilySetupPrompt(state: FamilySetupState): boolean {
  return state.appReady === true
    && state.familyLoading === false
    && state.familyData !== null
    && state.bootstrapStatus?.family === 'ready'
    && state.bootstrapStatus?.members === 'ready'
    && isOwnerRole(state.currentUser?.role)
    && !state.familyMembers.some(member => isChildRole(member?.role))
    && state.familyData.setup?.welcomePromptCompleted !== true;
}

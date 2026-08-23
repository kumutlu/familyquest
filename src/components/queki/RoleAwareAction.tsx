import { Plus, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { triggerHaptic } from '../../lib/interaction/haptics';
import { playCue } from '../../lib/interaction/sound';

export type ShellRole = 'parent' | 'child';

export interface RoleAwareActionDescriptor {
  /** i18n key (common ns) for the accessible label. */
  labelKey: 'nav.action.parent' | 'nav.action.child';
  Icon: React.ComponentType<{ size?: number | string; strokeWidth?: number; className?: string }>;
}

/**
 * Pure role → centre-action mapping. Exported for tests: the dominant centre
 * button must be obviously different per role.
 *   parent → "Create" (opens the Action Composer sheet)
 *   child  → "Do"     (jumps straight to their quests)
 */
export function getRoleAwareAction(role: string | undefined | null): RoleAwareActionDescriptor {
  if (role === 'child') return { labelKey: 'nav.action.child', Icon: Play };
  return { labelKey: 'nav.action.parent', Icon: Plus };
}

export interface RoleAwareActionButtonProps {
  role: string | undefined | null;
  onPress: () => void;
}

/**
 * The visually dominant centre Action button of the Queki v2 shell.
 * Oversized, elevated above the nav bar, role-labelled, keyboard reachable,
 * with subtle haptic + sound feedback.
 */
export function RoleAwareActionButton({ role, onPress }: RoleAwareActionButtonProps) {
  const { t } = useTranslation('common');
  const { labelKey, Icon } = getRoleAwareAction(role);

  return (
    <button
      type="button"
      data-testid="queki-centre-action"
      aria-label={t(labelKey)}
      onClick={() => {
        triggerHaptic('tap');
        playCue('tap');
        onPress();
      }}
      className="relative -mt-7 flex h-16 w-16 items-center justify-center rounded-full text-white sm:h-14 sm:w-14 sm:-mt-6"
      style={{
        background: 'linear-gradient(135deg, var(--color-primary-500), var(--color-primary-700))',
        boxShadow:
          '0 0 0 5px var(--qk-surface-card), 0 10px 24px -8px rgba(79,70,229,0.55), inset 0 -3px 0 rgba(0,0,0,0.22)',
        transition: 'transform var(--animate-duration-tap) var(--ease-tap)',
      }}
      onPointerDown={event => {
        // Depress on touch for the tactile feel.
        (event.currentTarget as HTMLButtonElement).style.transform = 'scale(0.94)';
      }}
      onPointerUp={event => {
        (event.currentTarget as HTMLButtonElement).style.transform = '';
      }}
      onPointerLeave={event => {
        (event.currentTarget as HTMLButtonElement).style.transform = '';
      }}
    >
      <Icon size={26} strokeWidth={2.5} />
    </button>
  );
}

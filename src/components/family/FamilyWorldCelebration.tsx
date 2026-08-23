import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { QuekiMascot } from '../queki/QuekiMascot';
import { TactileButton } from '../queki/TactileButton';
import { playCue } from '../../lib/interaction/sound';
import { triggerHaptic } from '../../lib/interaction/haptics';

interface FamilyWorldCelebrationProps {
  type: 'quest_complete' | 'achievement_unlocked';
  title: string;
  subtitle?: string;
  isOpen: boolean;
  onDismiss: () => void;
}

export const FamilyWorldCelebration: React.FC<FamilyWorldCelebrationProps> = ({
  type,
  title,
  subtitle,
  isOpen,
  onDismiss,
}) => {
  const { t } = useTranslation('familyWorld');

  useEffect(() => {
    if (isOpen) {
      triggerHaptic('success');
      playCue(type === 'quest_complete' ? 'celebrate' : 'achievement');
    }
  }, [isOpen, type]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="relative w-full max-w-sm rounded-3xl bg-white dark:bg-slate-800 p-6 text-center shadow-2xl border border-amber-400/30 overflow-hidden">
        {/* Glow background */}
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-48 bg-amber-400/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center">
          <div className="mb-3">
            <QuekiMascot state="celebration" size={80} />
          </div>

          <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-black uppercase tracking-wider mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {type === 'quest_complete'
                ? t('celebration.questComplete', { defaultValue: 'Family Quest complete!' })
                : t('celebration.achievementUnlocked', { defaultValue: 'Achievement unlocked' })}
            </span>
          </div>

          <h3 className="text-xl font-black text-slate-900 dark:text-white mb-1">
            {title}
          </h3>

          {subtitle && (
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
              {subtitle}
            </p>
          )}

          <TactileButton
            onClick={onDismiss}
            variant="primary"
            size="lg"
            fullWidth
            className="mt-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-black shadow-lg"
          >
            {t('celebration.dismiss', { defaultValue: 'Tap to continue' })}
          </TactileButton>
        </div>
      </div>
    </div>
  );
};

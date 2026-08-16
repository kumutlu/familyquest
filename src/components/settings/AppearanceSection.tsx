import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Sun, Moon, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppearance } from '../../hooks/useAppearance';
import type { Appearance } from '../../lib/appearance';

interface Option {
  value: Appearance;
  labelKey: 'appearanceSystem' | 'appearanceLight' | 'appearanceDark';
  descKey: 'appearanceSystemDesc' | 'appearanceLightDesc' | 'appearanceDarkDesc';
  Icon: typeof Monitor;
}

const OPTIONS: Option[] = [
  { value: 'system', labelKey: 'appearanceSystem', descKey: 'appearanceSystemDesc', Icon: Monitor },
  { value: 'light', labelKey: 'appearanceLight', descKey: 'appearanceLightDesc', Icon: Sun },
  { value: 'dark', labelKey: 'appearanceDark', descKey: 'appearanceDarkDesc', Icon: Moon },
];

/**
 * Appearance preference control. Implemented as an ARIA radiogroup (segmented
 * control) with roving tabindex and arrow-key navigation. The selected option
 * is distinguished by a ring, a check icon and font weight — never colour
 * alone — so it remains identifiable for colour-blind and low-vision users.
 */
export function AppearanceSection() {
  const { t } = useTranslation('settings');
  const { appearance, setAppearance } = useAppearance();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = (() => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        return (index + 1) % OPTIONS.length;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        return (index - 1 + OPTIONS.length) % OPTIONS.length;
      }
      return null;
    })();
    if (nextIndex === null) return;
    event.preventDefault();
    refs.current[nextIndex]?.focus();
    setAppearance(OPTIONS[nextIndex].value);
  };

  return (
    <section aria-labelledby="appearance-section" className="space-y-3">
      <div className="px-1">
        <h2
          id="appearance-section"
          className="text-lg font-bold text-gray-900 flex items-center gap-2"
        >
          <Monitor size={18} className="text-primary-500" aria-hidden="true" />
          {t('appearanceTitle')}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t('appearanceDesc')}</p>
      </div>

      <div
        role="radiogroup"
        aria-label={t('appearanceLabel')}
        className="grid grid-cols-1 sm:grid-cols-3 gap-2"
      >
        {OPTIONS.map((option, index) => {
          const selected = appearance === option.value;
          const { Icon } = option;
          return (
            <button
              key={option.value}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setAppearance(option.value)}
              onKeyDown={(event) => move(event, index)}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                selected
                  ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                  : 'border-gray-200 hover:border-primary-300',
              )}
            >
              <Icon
                size={18}
                className={cn('mt-0.5 shrink-0', selected ? 'text-primary-600' : 'text-gray-400')}
                aria-hidden="true"
              />
              <span className="flex-1">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'text-sm font-semibold',
                      selected ? 'text-primary-700' : 'text-gray-900',
                    )}
                  >
                    {t(option.labelKey)}
                  </span>
                  {selected && (
                    <Check size={14} className="text-primary-600" aria-hidden="true" />
                  )}
                </span>
                <span
                  className={cn(
                    'block text-xs mt-0.5',
                    selected ? 'text-primary-700/80' : 'text-gray-500',
                  )}
                >
                  {t(option.descKey)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

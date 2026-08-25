import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import {
  AVATAR_CONFIG_OPTIONS,
  avatarConfigToDataUrl,
  randomAvatarConfig,
  type AvatarConfigV1,
} from '../../config/avatarConfig';
import { cn } from '../../lib/utils';

type Category = 'base' | 'skin' | 'hair' | 'face' | 'accessory' | 'outfit' | 'background';
type ConfigKey = Exclude<keyof AvatarConfigV1, 'version'>;

const CATEGORIES: Array<{ id: Category; keys: ConfigKey[] }> = [
  { id: 'base', keys: ['base'] },
  { id: 'skin', keys: ['skinTone'] },
  { id: 'hair', keys: ['hairStyle', 'hairColor'] },
  { id: 'face', keys: ['face'] },
  { id: 'accessory', keys: ['accessory'] },
  { id: 'outfit', keys: ['outfit', 'outfitColor'] },
  { id: 'background', keys: ['background'] },
];

const LABELS: Record<string, string> = {
  round: 'Round', soft: 'Soft', bold: 'Bold',
  porcelain: 'Porcelain', fair: 'Fair', warm: 'Warm', tan: 'Tan', brown: 'Brown', deep: 'Deep',
  short: 'Short', crop: 'Crop', bob: 'Bob', waves: 'Waves', long: 'Long', curls: 'Curls', coils: 'Coils', ponytail: 'Ponytail',
  black: 'Black', chestnut: 'Chestnut', blonde: 'Blonde', copper: 'Copper', pink: 'Pink', purple: 'Purple', blue: 'Blue',
  smile: 'Smile', happy: 'Happy', bright: 'Bright', calm: 'Calm', cheeky: 'Cheeky',
  none: 'None', glasses: 'Glasses', 'round-glasses': 'Round glasses', cap: 'Cap', beanie: 'Beanie', headband: 'Headband',
  tee: 'T-shirt', hoodie: 'Hoodie', jacket: 'Jacket', sweater: 'Sweater',
  indigo: 'Indigo', teal: 'Teal', green: 'Green', coral: 'Coral', gold: 'Gold',
  lilac: 'Lilac', sky: 'Sky', mint: 'Mint', peach: 'Peach', sunny: 'Sunny', berry: 'Berry',
};

export function AvatarCreator({ value, onChange, disabled = false }: {
  value: AvatarConfigV1;
  onChange: (config: AvatarConfigV1) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('profile');
  const [category, setCategory] = useState<Category>('base');
  const active = CATEGORIES.find(item => item.id === category)!;

  return (
    <div data-testid="avatar-creator" className="min-w-0 rounded-2xl border border-primary-100 bg-primary-50/40 p-4">
      <div className="flex flex-col items-center">
        <img
          src={avatarConfigToDataUrl(value)}
          alt={t('creator.preview')}
          className="h-40 w-40 rounded-[2rem] shadow-lg ring-4 ring-white"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(randomAvatarConfig())}
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-primary-700 shadow-sm transition-colors hover:bg-primary-100 disabled:opacity-50"
        >
          <Sparkles size={16} aria-hidden="true" />
          {t('creator.surprise')}
        </button>
      </div>

      <div role="tablist" aria-label={t('creator.categories')} className="mt-5 flex gap-2 overflow-x-auto pb-2">
        {CATEGORIES.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={category === item.id}
            disabled={disabled}
            onClick={() => setCategory(item.id)}
            className={cn(
              'shrink-0 rounded-full px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50',
              category === item.id ? 'bg-primary-500 text-white' : 'bg-white qk-text-secondary hover:bg-primary-100',
            )}
          >
            {t(`creator.category.${item.id}`)}
          </button>
        ))}
      </div>

      <div data-testid="avatar-category-options" className="mt-3 space-y-4">
        {active.keys.map(key => (
          <fieldset key={key} className="min-w-0">
            {active.keys.length > 1 && <legend className="mb-2 text-xs font-bold uppercase tracking-wide qk-text-secondary">{t(`creator.field.${key}`)}</legend>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AVATAR_CONFIG_OPTIONS[key].map(option => (
                <button
                  key={option}
                  type="button"
                  disabled={disabled}
                  aria-pressed={value[key] === option}
                  onClick={() => onChange({ ...value, [key]: option })}
                  className={cn(
                    'min-h-11 min-w-0 rounded-xl border-2 px-2 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50',
                    value[key] === option ? 'border-primary-500 bg-primary-100 text-primary-800' : 'border-transparent bg-white qk-text-secondary hover:border-primary-200',
                  )}
                >
                  {t(`creator.option.${option}`, { defaultValue: LABELS[option] || option })}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}

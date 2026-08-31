/**
 * Smart Notifications V1 — parent-facing notification preferences UI.
 *
 * Surfaces the closed-shape NotificationPreferences to parents in plain
 * language. The Decision Engine stays the authority on what is sent;
 * this section only writes the family-level preference document.
 *
 * Architecture: family doc write → isValidNotificationPreferences
 * validator in firestore.rules. The Rules gate is the trust boundary;
 * this component is presentation only.
 *
 * Child accounts do not see this section (role gate).
 *
 * The English/Tr translations live in the existing i18n settings bundle
 * — we only add the keys this section needs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { doc, updateDoc } from 'firebase/firestore'
import { Bell, MapPin, Save } from 'lucide-react'

import { db } from '../../lib/firebase'
import { Button } from '../ui/Button'
import { Card, CardContent } from '../ui/Card'
import { cn } from '../../lib/utils'
import {
  PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES,
  isValidNotificationPreferences,
  normaliseNotificationPreferences,
  type NotificationIntensity,
  type NotificationPreferences,
} from '../../domain/notifications'

interface Props {
  readonly familyId: string
  readonly currentUserRole: 'parent' | 'owner' | 'child' | 'adult' | undefined
  readonly existing: Partial<NotificationPreferences> | null | undefined
}

const INTENSITIES: readonly NotificationIntensity[] = ['low', 'normal', 'high']

function parentWrites(role: Props['currentUserRole']): boolean {
  return role === 'parent' || role === 'owner'
}

export function NotificationPreferencesSection({ familyId, currentUserRole, existing }: Props) {
  const { t } = useTranslation('settings')

  const initial = useMemo(() => normaliseNotificationPreferences(existing), [existing])
  const [draft, setDraft] = useState<NotificationPreferences>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // When the Firestore-side value changes (e.g. parent refresh, sync
  // from another device), refresh the draft IF the user is not in the
  // middle of editing.
  useEffect(() => {
    if (!saving) setDraft(initial)
  }, [initial, saving])

  const onSave = useCallback(async () => {
    if (!familyId) return
    setSaving(true)
    setError(null)
    try {
      if (!isValidNotificationPreferences(draft)) {
        setError(t('notificationsInvalid', 'Invalid preferences'))
        setSaving(false)
        return
      }
      await updateDoc(doc(db, 'families', familyId), { notificationPreferences: draft })
      setSavedAt(Date.now())
    } catch (e) {
      setError((e as Error).message || t('notificationsSaveFailed', 'Save failed'))
    } finally {
      setSaving(false)
    }
  }, [draft, familyId, t])

  if (!parentWrites(currentUserRole)) {
    // Child accounts do not see this control per spec §26.
    return null
  }

  const toggleRow = (
    label: string,
    field: keyof NotificationPreferences,
    hint?: string,
  ) => {
    const value = draft[field]
    if (typeof value !== 'boolean') return null
    return (
      <label key={field} className="flex items-start justify-between gap-3 py-2">
        <div className="flex-1">
          <span className="text-sm font-medium text-gray-900">{label}</span>
          {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label={label}
          onClick={() => setDraft(d => ({ ...d, [field]: !value }))}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500',
            value ? 'bg-primary-600' : 'bg-gray-300',
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
              value ? 'translate-x-6' : 'translate-x-1',
            )}
          />
        </button>
      </label>
    )
  }

  return (
    <section aria-labelledby="smart-notifications-section" className="space-y-3">
      <div className="px-1">
        <h2 id="smart-notifications-section" className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary-600" aria-hidden="true" />
          {t('smartNotificationsTitle', 'Family nudges')}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {t('smartNotificationsDesc', 'Choose when Queki nudges your family. Nothing personal is sent without your say-so.')}
        </p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          {/* Master toggle */}
          <label className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <span className="text-sm font-semibold text-gray-900">
                {t('notificationsMasterToggle', 'Notifications')}
              </span>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('notificationsMasterToggleDesc', 'Allow Queki to send useful nudges to your family.')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.enabled}
              aria-label={t('notificationsMasterToggle', 'Notifications') ?? 'Notifications'}
              onClick={() => setDraft(d => ({ ...d, enabled: !d.enabled }))}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500',
                draft.enabled ? 'bg-primary-600' : 'bg-gray-300',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  draft.enabled ? 'translate-x-6' : 'translate-x-1',
                )}
              />
            </button>
          </label>

          <fieldset
            disabled={!draft.enabled}
            className={cn('space-y-3', !draft.enabled && 'opacity-50')}
          >
            <legend className="sr-only">{t('notificationsFrequency', 'Frequency')}</legend>

            {/* Frequency segmented control */}
            <div>
              <p className="text-sm font-medium text-gray-900">
                {t('notificationsFrequency', 'Frequency')}
              </p>
              <div role="radiogroup" className="mt-2 inline-flex rounded-lg border border-gray-200 bg-white" aria-label={t('notificationsFrequency', 'Frequency') ?? 'Frequency'}>
                {INTENSITIES.map((level) => {
                  const selected = draft.intensity === level
                  return (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setDraft(d => ({ ...d, intensity: level }))}
                      className={cn(
                        'px-3 py-1.5 text-sm font-medium first:rounded-l-lg last:rounded-r-lg focus:outline-none focus:ring-2 focus:ring-primary-500',
                        selected ? 'bg-primary-600 text-white' : 'text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      {t(`notificationsIntensity_${level}`, level)}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {t('notificationsIntensityHelp', 'High = up to 3 per day. Normal = up to 2. Low = up to 1.')}
              </p>
            </div>

            <div className="pt-3 border-t border-gray-100">
              {toggleRow(t('notificationsMorningBrief', 'Morning brief'), 'morningBrief', t('notificationsMorningBriefDesc', 'A friendly greeting in the morning.'))}
              {toggleRow(t('notificationsWeather', 'Weather in morning brief'), 'weather')}
              {toggleRow(t('notificationsQuestReminders', 'Quest reminders'), 'questReminders')}
              {toggleRow(t('notificationsSurgeAlerts', 'Surge alerts'), 'surgeAlerts', t('notificationsSurgeAlertsDesc', 'Bonus opportunities during your day.'))}
              {toggleRow(t('notificationsStreakAlerts', 'Streak reminders'), 'streakAlerts', t('notificationsStreakAlertsDesc', 'Gentle, never pushy.'))}
              {toggleRow(t('notificationsFamilyProgress', 'Family progress'), 'familyProgress')}
              {toggleRow(t('notificationsSeasonalEvents', 'Seasonal events'), 'seasonalEvents')}
            </div>

            {/* Quiet hours */}
            <div className="pt-3 border-t border-gray-100">
              <p className="text-sm font-medium text-gray-900">
                {t('notificationsQuietHours', 'Quiet hours')}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="text-xs text-gray-600">
                  {t('notificationsQuietStart', 'Start')}
                  <input
                    type="time"
                    value={draft.quietHours.start}
                    onChange={(e) =>
                      setDraft(d => ({ ...d, quietHours: { ...d.quietHours, start: e.target.value } }))
                    }
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  {t('notificationsQuietEnd', 'End')}
                  <input
                    type="time"
                    value={draft.quietHours.end}
                    onChange={(e) =>
                      setDraft(d => ({ ...d, quietHours: { ...d.quietHours, end: e.target.value } }))
                    }
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
            </div>

            {/* Weather location */}
            <div className="pt-3 border-t border-gray-100">
              <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-primary-600" aria-hidden="true" />
                {t('notificationsWeatherLocation', 'Weather location')}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('notificationsWeatherLocationDesc', 'Coarse city or postal area only. No precise address stored.')}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="text-xs text-gray-600">
                  {t('notificationsWeatherCity', 'City')}
                  <input
                    type="text"
                    maxLength={80}
                    placeholder={t('notificationsWeatherCityPlaceholder', 'e.g. Nottingham') ?? ''}
                    value={draft.weatherLocation?.city ?? ''}
                    onChange={(e) =>
                      setDraft(d => ({
                        ...d,
                        weatherLocation: {
                          countryCode: d.weatherLocation?.countryCode ?? 'GB',
                          postalArea: d.weatherLocation?.postalArea ?? '',
                          timezone: d.weatherLocation?.timezone ?? 'Europe/London',
                          city: e.target.value,
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  {t('notificationsWeatherPostalArea', 'Postal area')}
                  <input
                    type="text"
                    maxLength={24}
                    placeholder={t('notificationsWeatherPostalAreaPlaceholder', 'e.g. NG6') ?? ''}
                    value={draft.weatherLocation?.postalArea ?? ''}
                    onChange={(e) =>
                      setDraft(d => ({
                        ...d,
                        weatherLocation: {
                          countryCode: d.weatherLocation?.countryCode ?? 'GB',
                          timezone: d.weatherLocation?.timezone ?? 'Europe/London',
                          postalArea: e.target.value,
                          city: d.weatherLocation?.city ?? '',
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
            </div>
          </fieldset>

          <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
            <div>
              {error && (
                <p className="text-sm text-red-600" role="alert">{error}</p>
              )}
              {!error && savedAt && (
                <p className="text-xs text-green-700" role="status">
                  {t('notificationsSaved', 'Saved.')}
                </p>
              )}
            </div>
            <Button
              variant="primary"
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-2"
              data-testid="save-notification-prefs"
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              {saving ? t('common:saving', 'Saving…') : t('common:save', 'Save')}
            </Button>
          </div>

          <details className="pt-3 border-t border-gray-100">
            <summary className="text-xs text-gray-500 cursor-pointer">
              {t('notificationsResetDefaults', 'Reset to recommended defaults')}
            </summary>
            <div className="mt-2">
              <Button
                variant="secondary"
                onClick={() => setDraft({ ...PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES })}
              >
                {t('notificationsResetButton', 'Use defaults')}
              </Button>
            </div>
          </details>
        </CardContent>
      </Card>
    </section>
  )
}
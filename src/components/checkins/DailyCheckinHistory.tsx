import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DAILY_CHECKIN_CATALOG,
  familyDayKey,
  resolvedDailyCheckinSettings,
  summarizeDailyCheckins,
  type DailyCheckinRecord,
} from '../../lib/dailyCheckins';
import { useStore } from '../../store/useStore';

const formatDate = (localDate: string, locale: string) => {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
};

const englishCount = (count: number) => [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
][count] ?? String(count);

export function DailyCheckinHistory() {
  const { t, i18n } = useTranslation('checkins');
  const {
    currentUser,
    familyData,
    familyMembers,
    dailyCheckinDay,
    dailyCheckinHistory,
    dailyCheckinHistoryResolved,
    featureErrors,
  } = useStore();
  const [memberId, setMemberId] = useState('all');
  const settings = resolvedDailyCheckinSettings(familyData?.dailyCheckins);

  if (!settings.historyVisibleToParents) {
    return (
      <section aria-labelledby="daily-checkin-history-title" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 id="daily-checkin-history-title" className="text-lg font-bold text-gray-900">{t('history.title')}</h2>
        <p className="mt-2 text-sm text-gray-600">{t('history.disabled')}</p>
      </section>
    );
  }

  if (featureErrors?.dailyCheckinHistory) {
    return (
      <section aria-labelledby="daily-checkin-history-title" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 id="daily-checkin-history-title" className="text-lg font-bold text-gray-900">{t('history.title')}</h2>
        <p role="alert" className="mt-2 text-sm text-red-600">{t('history.error')}</p>
      </section>
    );
  }

  if (!dailyCheckinHistoryResolved) {
    return (
      <section aria-labelledby="daily-checkin-history-title" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 id="daily-checkin-history-title" className="text-lg font-bold text-gray-900">{t('history.title')}</h2>
        <p role="status" className="mt-2 text-sm text-gray-600">{t('history.loading')}</p>
      </section>
    );
  }

  const familyId = currentUser?.familyId ?? familyData?.id;
  const members = (familyMembers ?? []).filter(member => !member.familyId || member.familyId === familyId);
  const memberNames = new Map(members.map(member => [member.id, member.displayName || member.name]));
  const records = (dailyCheckinHistory ?? []).filter((record): record is DailyCheckinRecord =>
    record.familyId === familyId && DAILY_CHECKIN_CATALOG.some(option => option.id === record.animal),
  );
  const filteredRecords = memberId === 'all' ? records : records.filter(record => record.userId === memberId);
  const newestFirst = [...filteredRecords].sort((left, right) => right.localDate.localeCompare(left.localDate));
  const today = dailyCheckinDay ?? familyDayKey(new Date(), familyData?.timezone);
  const summary = summarizeDailyCheckins(filteredRecords, today);

  return (
    <section aria-labelledby="daily-checkin-history-title" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="daily-checkin-history-title" className="text-lg font-bold text-gray-900">{t('history.title')}</h2>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          {t('history.filter')}
          <select
            aria-label={t('history.filter')}
            value={memberId}
            onChange={event => setMemberId(event.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">{t('history.allMembers')}</option>
            {members.map(member => (
              <option key={member.id} value={member.id}>{member.displayName || member.name || t('history.unknownMember')}</option>
            ))}
          </select>
        </label>
      </div>

      {filteredRecords.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600">{t('history.empty')}</p>
      ) : (
        <>
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-gray-900">{t('history.summary')}</h3>
            <ul className="mt-2 space-y-1 text-sm text-gray-700">
              {summary.map(item => {
                const option = DAILY_CHECKIN_CATALOG.find(candidate => candidate.id === item.animal)!;
                const member = memberNames.get(item.userId) || t('history.unknownMember');
                const formattedCount = i18n.language.startsWith('en')
                  ? englishCount(item.count)
                  : String(item.count);
                return (
                  <li key={`${item.userId}:${item.animal}`}>
                    {item.count === 1
                      ? t('history.summaryLine_one', { member, feeling: t(option.feelingKey) })
                      : t('history.summaryLine_other', {
                          member,
                          feeling: t(option.feelingKey),
                          count: item.count,
                          formattedCount,
                        })}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-5">
            <h3 className="text-sm font-semibold text-gray-900">{t('history.recent')}</h3>
            <ol aria-label={t('history.recent')} className="mt-2 space-y-2">
              {newestFirst.map(record => {
                const option = DAILY_CHECKIN_CATALOG.find(candidate => candidate.id === record.animal)!;
                const member = memberNames.get(record.userId) || t('history.unknownMember');
                return (
                  <li key={record.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    <time dateTime={record.localDate}>{formatDate(record.localDate, i18n.language)}</time>
                    <span className="font-medium text-gray-900">{member}</span>
                    <span aria-label={t(option.nameKey)}>{option.emoji} {t(option.nameKey)}</span>
                    <span>{t(option.feelingKey)}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, BellRing, ChevronDown, Pin, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { createTask } from '../../lib/api';
import {
  ANNOUNCEMENT_TYPES,
  AUDIENCE_TYPES,
  PRIORITIES,
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  isAnnouncementActive,
  markAnnouncementRead,
  sortAnnouncements,
  subscribeToAnnouncementReads,
  subscribeToAnnouncements,
  updateAnnouncement,
  type AnnouncementAudience,
  type AnnouncementPriority,
  type AnnouncementType,
  type FamilyAnnouncement,
} from '../../lib/familyBulletin';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';

const tone = {
  normal: 'border-primary-100 bg-primary-50',
  important: 'border-amber-200 bg-amber-50',
  urgent: 'border-red-200 bg-red-50',
};

export function FamilyBulletin() {
  const { t } = useTranslation('bulletin');
  const navigate = useNavigate();
  const currentUser = useStore(state => state.currentUser);
  const familyMembers = useStore(state => state.familyMembers);
  const tasks = useStore(state => state.tasks);
  const [items, setItems] = useState<FamilyAnnouncement[]>([]);
  const [readIds, setReadIds] = useState(new Set<string>());
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FamilyAnnouncement | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');

  const familyId = currentUser?.familyId;
  useEffect(() => {
    if (!familyId || !currentUser?.id) return;
    const stopAnnouncements = subscribeToAnnouncements(
      familyId,
      { id: currentUser.id, role: currentUser.role },
      setItems,
      () => setError(t('loadError')),
    );
    const stopReads = subscribeToAnnouncementReads(familyId, currentUser.id, setReadIds);
    return () => {
      stopAnnouncements();
      stopReads();
    };
  }, [familyId, currentUser?.id, currentUser?.role, t]);

  const active = useMemo(
    () => sortAnnouncements(items.filter(item => isAnnouncementActive(item))),
    [items],
  );
  const history = useMemo(
    () => sortAnnouncements(items.filter(item => !isAnnouncementActive(item))),
    [items],
  );
  const visibleItems = showHistory ? history : active;
  const shown = expanded || showHistory ? visibleItems : visibleItems.slice(0, 1);
  const canManage = currentUser?.role === 'owner' || currentUser?.role === 'parent';

  if (!currentUser || !familyId) return null;

  return (
    <section aria-labelledby="family-bulletin-heading" className="space-y-3">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h2 id="family-bulletin-heading" className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <BellRing size={20} className="text-primary-500" />
            {t('title')}
          </h2>
          {active.some(item => !readIds.has(item.id)) && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{t('unread')}</span>
          )}
        </div>
        {canManage && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowHistory(value => !value)}>
              {showHistory ? t('active') : t('history')}
            </Button>
            <Button size="sm" onClick={() => setCreating(true)} className="w-full sm:w-auto">
              <Plus size={16} className="mr-1" /> {t('create')}
            </Button>
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {visibleItems.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <div className="space-y-3">
          {shown.map(item => (
            <article key={item.id} className={`rounded-2xl border p-4 ${tone[item.priority]}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-bold text-gray-900">
                    {item.pinned && <Pin size={15} aria-label={t('pinned')} />}
                    {item.priority === 'urgent' && <AlertTriangle size={16} className="text-red-600" />}
                    {item.title}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{item.message}</p>
                </div>
                {!readIds.has(item.id) && (
                  <Button
                    size="sm"
                    variant="primary"
                    className="min-h-[44px] w-full sm:w-auto"
                    onClick={() => markAnnouncementRead(familyId, item.id, currentUser.id)}
                  >
                    {t('markRead')}
                  </Button>
                )}
              </div>
              {(item.linkedTaskId || item.linkedRewardId) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full sm:w-auto"
                  onClick={() => navigate(item.linkedTaskId ? '/tasks' : '/rewards')}
                >
                  {item.linkedTaskId ? t('viewTask') : t('viewReward')}
                </Button>
              )}
              {canManage && (
                <div className="mt-2 space-y-1.5 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
                  {/* Edit + Archive share one row on mobile */}
                  <div className="grid grid-cols-2 gap-1.5 sm:contents">
                    <Button size="sm" variant="outline" onClick={() => setEditing(item)} className="min-h-[44px] w-full sm:w-auto">{t('edit')}</Button>
                    {item.status === 'active' ? (
                      <Button size="sm" variant="outline" onClick={() => archiveAnnouncement(familyId, item.id)} className="min-h-[44px] w-full sm:w-auto">{t('archive')}</Button>
                    ) : (
                      <span aria-hidden="true" className="sm:hidden" />
                    )}
                  </div>
                  {/* Delete stays separate as a destructive action */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.confirm(t('deleteConfirm')) && deleteAnnouncement(familyId, item.id)}
                    className="min-h-[44px] w-full text-danger-500 hover:bg-red-50 hover:text-danger-600 sm:w-auto"
                  >
                    {t('delete')}
                  </Button>
                </div>
              )}
            </article>
          ))}
          {!showHistory && active.length > 1 && (
            <Button variant="ghost" size="sm" onClick={() => setExpanded(value => !value)} className="w-full">
              <ChevronDown size={16} className="mr-1" />
              {expanded ? t('showLess') : t('showMore', { count: active.length - 1 })}
            </Button>
          )}
        </div>
      )}

      {creating && (
        <AnnouncementForm
          familyId={familyId}
          members={familyMembers}
          tasks={tasks}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <AnnouncementForm
          familyId={familyId}
          members={familyMembers}
          tasks={tasks}
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function AnnouncementForm({
  familyId,
  members,
  tasks,
  initial,
  onClose,
}: {
  familyId: string;
  members: any[];
  tasks: any[];
  initial?: FamilyAnnouncement;
  onClose: () => void;
}) {
  const { t } = useTranslation('bulletin');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [message, setMessage] = useState(initial?.message ?? '');
  const [type, setType] = useState<AnnouncementType>(initial?.type ?? 'general');
  const [audienceType, setAudienceType] = useState<AnnouncementAudience>(initial?.audienceType ?? 'family');
  const [audienceUserIds, setAudienceUserIds] = useState<string[]>(initial?.audienceUserIds ?? []);
  const [priority, setPriority] = useState<AnnouncementPriority>(initial?.priority ?? 'normal');
  const [startsAt, setStartsAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [linkedTaskId, setLinkedTaskId] = useState(initial?.linkedTaskId ?? '');
  const [createOneTimeTask, setCreateOneTimeTask] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !message.trim()) return setError(t('required'));
    if (audienceType === 'selected' && audienceUserIds.length === 0) return setError(t('selectMember'));
    if (startsAt && expiresAt && new Date(expiresAt) <= new Date(startsAt)) return setError(t('invalidSchedule'));
    setSaving(true);
    setError('');
    try {
      let taskId = linkedTaskId || undefined;
      if (createOneTimeTask) {
        const childId = audienceUserIds.find(id => members.find(member => member.id === id)?.role === 'child');
        const taskRef = await createTask(familyId, {
          title: title.trim(),
          description: message.trim(),
          pointsReward: 10,
          type: 'one-time',
          customDays: [],
          requiresApproval: true,
          assigneeId: childId || null,
          isActive: true,
        });
        taskId = taskRef.id;
      }
      const payload = {
        title: title.trim(),
        message: message.trim(),
        type,
        audienceType,
        audienceUserIds: audienceType === 'selected' ? audienceUserIds : [],
        priority,
        ...(startsAt ? { startsAt: new Date(startsAt) } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
        pinned,
        status: 'active' as const,
        ...(taskId ? { linkedTaskId: taskId } : {}),
      };
      if (initial) await updateAnnouncement(familyId, initial.id, payload);
      else await createAnnouncement(familyId, payload);
      onClose();
    } catch (cause) {
      console.error('[family-bulletin] create failed', cause);
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/40 sm:items-center">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl">
        <h2 className="text-xl font-bold">{initial ? t('form.editTitle') : t('form.title')}</h2>
        <label className="block text-sm font-medium">{t('form.announcementTitle')}
          <input aria-label={t('form.announcementTitle')} value={title} onChange={event => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border p-2" />
        </label>
        <label className="block text-sm font-medium">{t('form.message')}
          <textarea aria-label={t('form.message')} value={message} onChange={event => setMessage(event.target.value)} className="mt-1 w-full rounded-lg border p-2" rows={3} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Select label={t('form.type')} value={type} onChange={(value: string) => setType(value as AnnouncementType)} options={ANNOUNCEMENT_TYPES} t={t} prefix="types" />
          <Select label={t('form.priority')} value={priority} onChange={(value: string) => setPriority(value as AnnouncementPriority)} options={PRIORITIES} t={t} prefix="priorities" />
        </div>
        <Select label={t('form.audience')} value={audienceType} onChange={(value: string) => setAudienceType(value as AnnouncementAudience)} options={AUDIENCE_TYPES} t={t} prefix="audiences" />
        {audienceType === 'selected' && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('form.members')}</legend>
            {members.map(member => (
              <label key={member.id} className="flex gap-2 text-sm">
                <input type="checkbox" checked={audienceUserIds.includes(member.id)} onChange={() => setAudienceUserIds(ids => ids.includes(member.id) ? ids.filter(id => id !== member.id) : [...ids, member.id])} />
                {member.displayName}
              </label>
            ))}
          </fieldset>
        )}
        <label className="block text-sm font-medium">{t('form.linkTask')}
          <select value={linkedTaskId} onChange={event => setLinkedTaskId(event.target.value)} className="mt-1 w-full rounded-lg border p-2">
            <option value="">{t('form.noTask')}</option>
            {tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={createOneTimeTask} onChange={event => setCreateOneTimeTask(event.target.checked)} />{t('form.createTask')}</label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">{t('form.starts')}<input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
          <label className="text-sm">{t('form.expires')}<input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
        </div>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={pinned} onChange={event => setPinned(event.target.checked)} />{t('form.pin')}</label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" className="flex-1" disabled={saving}>{saving ? t('saving') : initial ? t('save') : t('publish')}</Button>
        </div>
      </form>
    </div>
  );
}

function Select({ label, value, onChange, options, t, prefix }: any) {
  return (
    <label className="block text-sm font-medium">{label}
      <select aria-label={label} value={value} onChange={event => onChange(event.target.value)} className="mt-1 w-full rounded-lg border p-2">
        {options.map((option: string) => <option key={option} value={option}>{t(`${prefix}.${option}`)}</option>)}
      </select>
    </label>
  );
}

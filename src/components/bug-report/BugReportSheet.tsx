import { useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  RefreshCw,
  Send,
} from 'lucide-react';
import { BottomSheet } from '../queki/BottomSheet';
import { TactileButton } from '../queki/TactileButton';
import {
  BUG_REPORT_CATEGORIES,
  collectTechnicalContext,
  submitBugReport,
  type BugReportCategory,
  type TechnicalContext,
} from '../../lib/bugReports';
import { triggerHaptic } from '../../lib/interaction/haptics';
import { playCue } from '../../lib/interaction/sound';
import { cn } from '../../lib/utils';

export interface BugReportSheetProps {
  open: boolean;
  onClose: () => void;
  initialCategory?: BugReportCategory;
}

export function BugReportSheet({
  open,
  onClose,
  initialCategory = 'broken',
}: BugReportSheetProps) {
  const { t, i18n } = useTranslation('common');
  const location = useLocation();

  const [category, setCategory] = useState<BugReportCategory>(initialCategory);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showTechDetails, setShowTechDetails] = useState(false);

  const submittingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const technicalContext: TechnicalContext = useMemo(
    () =>
      collectTechnicalContext(
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
          ? 'dark'
          : 'light',
        i18n.resolvedLanguage || i18n.language,
        location.pathname,
      ),
    [i18n.language, i18n.resolvedLanguage, location.pathname],
  );

  const handleClose = useCallback(() => {
    if (status === 'submitting') return;
    setStatus('idle');
    setErrorMessage(null);
    onClose();
  }, [status, onClose]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (submittingRef.current || status === 'submitting') return;

    const trimmed = description.trim();
    if (trimmed.length < 3) {
      setErrorMessage(t('bugReport.descriptionMinHint'));
      textareaRef.current?.focus();
      return;
    }

    submittingRef.current = true;
    setStatus('submitting');
    setErrorMessage(null);

    try {
      await submitBugReport({
        category,
        description: trimmed,
        technicalContext,
      });

      triggerHaptic('success');
      playCue('success');
      setStatus('success');
    } catch (err: any) {
      console.error('[BugReport] submission failed:', err);
      setStatus('error');
      setErrorMessage(err?.message || t('bugReport.errorTitle'));
    } finally {
      submittingRef.current = false;
    }
  };

  const isSubmitting = status === 'submitting';
  const isSuccess = status === 'success';

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      aria-label={t('bugReport.title')}
      title={t('bugReport.title')}
    >
      <div className="space-y-4 pb-2" data-testid="bug-report-sheet">
        {isSuccess ? (
          <div
            className="flex flex-col items-center gap-3 py-6 text-center animate-in fade-in"
            data-testid="bug-report-success"
            role="status"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-mint-50 text-mint-600 dark:bg-mint-100 dark:text-mint-400">
              <CheckCircle2 size={36} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-title font-extrabold qk-text-primary">
                {t('bugReport.successTitle')}
              </h3>
              <p className="mt-1 text-body qk-text-secondary">
                {t('bugReport.successSubtitle')}
              </p>
            </div>
            <TactileButton
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleClose}
              data-testid="bug-report-success-close"
              className="mt-4"
            >
              {t('bugReport.close')}
            </TactileButton>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" data-testid="bug-report-form">
            <div>
              <h3 className="text-card-title font-bold qk-text-primary">
                {t('bugReport.prompt')}
              </h3>
              <p className="mt-0.5 text-meta qk-text-secondary">
                {t('bugReport.promptSubtitle')}
              </p>
            </div>

            {/* Category selection */}
            <fieldset className="space-y-2">
              <legend className="text-meta font-bold qk-text-secondary">
                {t('bugReport.categoryLabel')}
              </legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('bugReport.categoryLabel')}>
                {BUG_REPORT_CATEGORIES.map(cat => {
                  const selected = category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setCategory(cat)}
                      data-testid={`bug-category-${cat}`}
                      className={cn(
                        'inline-flex min-h-11 items-center justify-center rounded-xl px-3.5 py-2 text-sm font-semibold transition-all select-none',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                        selected
                          ? 'bg-primary-500 text-white shadow-sm ring-2 ring-primary-500 ring-offset-1 dark:ring-offset-gray-900'
                          : 'qk-bg-card qk-text-primary border qk-border-subtle hover:bg-black/5 dark:hover:bg-white/5',
                      )}
                    >
                      {t(`bugReport.categories.${cat}`)}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Description multiline input */}
            <div className="space-y-1.5">
              <label
                htmlFor="bug-report-description"
                className="block text-meta font-bold qk-text-secondary"
              >
                {t('bugReport.descriptionLabel')}
              </label>
              <textarea
                ref={textareaRef}
                id="bug-report-description"
                name="description"
                data-testid="bug-report-textarea"
                rows={4}
                required
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t('bugReport.descriptionPlaceholder')}
                disabled={isSubmitting}
                className={cn(
                  'w-full resize-none rounded-xl border p-3 text-body outline-none transition-all',
                  'qk-bg-card qk-text-primary qk-border-subtle',
                  'placeholder:text-gray-400 dark:placeholder:text-gray-500',
                  'focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20',
                  'disabled:opacity-60 disabled:cursor-not-allowed',
                )}
              />
            </div>

            {/* Technical Context Preview */}
            <div className="rounded-xl border qk-border-subtle p-3 qk-bg-card">
              <button
                type="button"
                onClick={() => setShowTechDetails(prev => !prev)}
                data-testid="bug-report-tech-toggle"
                className="flex w-full items-center justify-between text-meta font-bold qk-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <span className="flex items-center gap-1.5">
                  <Cpu size={15} aria-hidden="true" />
                  {t('bugReport.technicalDetails')}
                </span>
                {showTechDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {showTechDetails && (
                <div
                  className="mt-2 space-y-1.5 border-t qk-border-subtle pt-2 text-xs text-gray-500 dark:text-gray-400 animate-in fade-in"
                  data-testid="bug-report-tech-details"
                >
                  <p>{t('bugReport.technicalDetailsDesc')}</p>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px]">
                    <div>
                      <span className="font-semibold text-gray-600 dark:text-gray-300">
                        {t('bugReport.techVersion')}:
                      </span>{' '}
                      {technicalContext.releaseVersion} ({technicalContext.releaseSha.slice(0, 7)})
                    </div>
                    <div>
                      <span className="font-semibold text-gray-600 dark:text-gray-300">
                        {t('bugReport.techRoute')}:
                      </span>{' '}
                      {technicalContext.route}
                    </div>
                    <div>
                      <span className="font-semibold text-gray-600 dark:text-gray-300">
                        {t('bugReport.techScreen')}:
                      </span>{' '}
                      {technicalContext.viewport.width}×{technicalContext.viewport.height}
                    </div>
                    <div>
                      <span className="font-semibold text-gray-600 dark:text-gray-300">
                        {t('bugReport.techLanguage')}:
                      </span>{' '}
                      {technicalContext.locale} ({technicalContext.theme})
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Error Banner */}
            {status === 'error' && errorMessage && (
              <div
                role="alert"
                data-testid="bug-report-error"
                className="flex items-center gap-2.5 rounded-xl bg-coral-50 p-3 text-body font-semibold text-coral-700 dark:bg-coral-100 dark:text-coral-300 animate-in fade-in"
              >
                <AlertCircle size={18} className="shrink-0" aria-hidden="true" />
                <span className="flex-1 text-sm">{errorMessage}</span>
              </div>
            )}

            {/* CTA Buttons */}
            <div className="pt-2 flex flex-col gap-2">
              <TactileButton
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                disabled={isSubmitting || description.trim().length < 3}
                loading={isSubmitting}
                data-testid="bug-report-submit"
                className="min-h-12"
              >
                <Send size={18} aria-hidden="true" />
                {isSubmitting ? t('bugReport.submitting') : t('bugReport.submit')}
              </TactileButton>

              {status === 'error' && (
                <TactileButton
                  type="button"
                  variant="secondary"
                  size="md"
                  fullWidth
                  onClick={() => handleSubmit()}
                  data-testid="bug-report-retry"
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  {t('bugReport.retry')}
                </TactileButton>
              )}
            </div>
          </form>
        )}
      </div>
    </BottomSheet>
  );
}

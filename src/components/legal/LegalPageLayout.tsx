import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { applyLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n';
import { cn } from '../../lib/utils';

export interface LegalSection {
  heading: string;
  body: string[];
}

interface LegalPageLayoutProps {
  /** Key of the document inside the `legal` namespace, e.g. `privacy`. */
  documentKey: 'privacy' | 'terms' | 'accountDeletion';
}

/**
 * Shared shell for the three PUBLIC legal surfaces (/privacy, /terms,
 * /account-deletion).
 *
 * These pages are deliberately rendered outside `AppLayout`: they must be
 * reachable without authentication (App Store / Play Store review, and users
 * who can no longer sign in), so they never touch the auth store and never
 * render authenticated navigation.
 *
 * Because the pages can be opened directly — outside the app, with no signed-in
 * profile to read a language preference from — the language selector here works
 * purely on i18next + the document element, without persisting to Firestore.
 */
function setMetaDescription(content: string): void {
  if (typeof document === 'undefined') return;
  let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', 'description');
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  tr: 'Türkçe',
};

export function LegalPageLayout({ documentKey }: LegalPageLayoutProps) {
  const { t, i18n } = useTranslation('legal');

  const title = t(`${documentKey}.title`);
  const metaDescription = t(`${documentKey}.metaDescription`);
  const intro = t(`${documentKey}.intro`);
  const sections = t(`${documentKey}.sections`, { returnObjects: true }) as unknown;
  const sectionList: LegalSection[] = Array.isArray(sections) ? (sections as LegalSection[]) : [];

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = `${title} · Queki`;
    setMetaDescription(metaDescription);
  }, [title, metaDescription]);

  const currentLanguage = (i18n.language?.split('-')[0] ?? 'en') as SupportedLanguage;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="text-sm font-semibold text-primary-600 hover:underline">
            {t('backToApp')}
          </Link>
          <div className="flex items-center gap-2" role="group" aria-label={t('languageLabel')}>
            {SUPPORTED_LANGUAGES.map(lang => (
              <button
                key={lang}
                type="button"
                lang={lang}
                aria-pressed={currentLanguage === lang}
                onClick={() => { void applyLanguage(lang); }}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                  currentLanguage === lang
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                )}
              >
                {LANGUAGE_LABELS[lang]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <article className="rounded-2xl bg-white p-5 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-2 text-sm text-gray-500">{t('lastUpdated')}</p>
          <p className="mt-4 text-base leading-relaxed text-gray-700">{intro}</p>

          {sectionList.map(section => (
            <section key={section.heading} className="mt-8">
              <h2 className="text-lg font-semibold sm:text-xl">{section.heading}</h2>
              {section.body.map(paragraph => (
                <p key={paragraph} className="mt-3 text-base leading-relaxed text-gray-700">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}

          <section className="mt-8">
            <h2 className="text-lg font-semibold sm:text-xl">{t('contactHeading')}</h2>
            <p className="mt-3 text-base leading-relaxed text-gray-700">{t('contactBody')}</p>
          </section>
        </article>

        <nav aria-label={t('nav.privacy')} className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link to="/privacy" className="text-primary-600 hover:underline">{t('nav.privacy')}</Link>
          <Link to="/terms" className="text-primary-600 hover:underline">{t('nav.terms')}</Link>
          <Link to="/account-deletion" className="text-primary-600 hover:underline">
            {t('nav.accountDeletion')}
          </Link>
        </nav>
      </main>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { HelpArticle } from '../types';

interface Props {
  article: HelpArticle;
  snippet?: string;
  compact?: boolean;
}

export function HelpArticleCard({ article, snippet, compact = false }: Props) {
  const { t } = useTranslation('help');
  return (
    <Link
      to={`/help/${article.id}`}
      className={cn(
        'group block rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition',
        'hover:border-indigo-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-gray-900 group-hover:text-indigo-700">{article.title}</h3>
        <ArrowRight
          size={16}
          aria-hidden
          className="mt-1 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500"
        />
      </div>
      {!compact ? (
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-gray-600">
          {snippet ?? article.description}
        </p>
      ) : null}
      <p className="mt-2 flex items-center gap-1 text-xs text-gray-400">
        <Clock size={12} aria-hidden />
        {t('readingTime', { count: article.readingTimeMinutes })}
      </p>
    </Link>
  );
}

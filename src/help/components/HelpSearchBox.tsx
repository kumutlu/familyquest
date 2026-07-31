import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { useHelpSearch } from '../useHelpArticles';

interface Props {
  /** Renders inline suggestions under the field (Help Home behaviour). */
  withSuggestions?: boolean;
  initialQuery?: string;
  autoFocus?: boolean;
  onQueryChange?: (query: string) => void;
}

export function HelpSearchBox({
  withSuggestions = true,
  initialQuery = '',
  autoFocus = false,
  onQueryChange,
}: Props) {
  const { t } = useTranslation('help');
  const navigate = useNavigate();
  const [value, setValue] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 150);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    onQueryChange?.(debounced);
  }, [debounced, onQueryChange]);

  const { results } = useHelpSearch(withSuggestions ? debounced : '');
  const suggestions = results.slice(0, 5);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const submit = (query: string) => {
    if (query.trim().length === 0) return;
    setOpen(false);
    navigate(`/help/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div ref={containerRef} className="relative">
      <form
        role="search"
        onSubmit={event => {
          event.preventDefault();
          submit(value);
        }}
      >
        <label htmlFor="help-search" className="sr-only">
          {t('search.label')}
        </label>
        <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
          <Search size={18} className="shrink-0 text-gray-400" aria-hidden />
          <input
            id="help-search"
            type="search"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={autoFocus}
            value={value}
            onChange={event => {
              setValue(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={t('search.placeholder')}
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-gray-400"
            autoComplete="off"
            aria-expanded={open && suggestions.length > 0}
            aria-controls="help-search-suggestions"
          />
          {value ? (
            <button
              type="button"
              onClick={() => {
                setValue('');
                setDebounced('');
              }}
              aria-label={t('search.clear')}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X size={16} aria-hidden />
            </button>
          ) : null}
        </div>
      </form>

      {withSuggestions && open && debounced.trim().length > 0 ? (
        <div
          id="help-search-suggestions"
          className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg"
        >
          {suggestions.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">{t('search.noResults', { query: debounced })}</p>
          ) : (
            <ul>
              {suggestions.map(match => (
                <li key={match.article.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      navigate(`/help/${match.article.id}`);
                    }}
                    className="block w-full px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                  >
                    <span className="block text-sm font-medium text-gray-900">
                      {match.article.title}
                    </span>
                    <span className="block line-clamp-1 text-xs text-gray-500">{match.snippet}</span>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => submit(value)}
                  className="block w-full border-t border-gray-100 px-4 py-3 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50"
                >
                  {t('search.seeAll', { query: debounced })}
                </button>
              </li>
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

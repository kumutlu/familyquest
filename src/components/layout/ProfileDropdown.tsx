import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { User, Settings, LogOut, HelpCircle } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { useStore } from '../../store/useStore';
import { getRoleLabel } from '../../lib/roles';
import { signOut } from '../../lib/api';
import { ProfileEditorModal } from '../profile/ProfileEditorModal';

const menuItemClass =
  'flex items-center space-x-3 w-full px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors text-left focus:outline-none focus:bg-gray-50';

/**
 * Role-aware profile dropdown used by Owner, Parent and Child.
 * Only the rendered menu items differ between roles; the component itself is shared.
 */
export function ProfileDropdown() {
  const { t } = useTranslation(['settings', 'common', 'help']);
  const currentUser = useStore(state => state.currentUser);
  const [isOpen, setIsOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape + move focus into the menu when opened
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!currentUser) return null;

  const close = () => setIsOpen(false);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (e) {
      console.error(e);
    }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = items[(currentIndex + 1) % items.length] ?? items[0];
      next?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = items[(currentIndex - 1 + items.length) % items.length] ?? items[items.length - 1];
      prev?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        aria-label={t('profileMenuAria')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="rounded-full focus:outline-none focus:ring-2 focus:ring-primary-200"
      >
        <Avatar
          fallback={currentUser.displayName[0]}
          src={currentUser.avatarUrl}
          size="sm"
          className="ring-2 ring-primary-100"
        />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('profileMenuAria')}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50 origin-top-right"
        >
          {/* Header */}
          <div className="flex items-center space-x-3 px-4 py-3 border-b border-gray-50 bg-gray-50">
            <Avatar
              fallback={currentUser.displayName[0]}
              src={currentUser.avatarUrl}
              size="sm"
            />
            <div className="min-w-0">
              <div className="text-sm font-bold text-gray-900 truncate">
                {currentUser.displayName}
              </div>
              <div className="text-xs text-gray-500">{getRoleLabel(currentUser.role)}</div>
            </div>
          </div>

          <div className="py-1">
            <button
              type="button"
              role="menuitem"
              tabIndex={0}
              onClick={() => {
                close();
                setEditorOpen(true);
              }}
              className={menuItemClass}
            >
              <User size={18} className="text-gray-400" />
              <span>{t('editProfile')}</span>
            </button>

            <Link
              to="/help"
              role="menuitem"
              tabIndex={0}
              onClick={close}
              className={menuItemClass}
            >
              <HelpCircle size={18} className="text-gray-400" />
              <span>{t('help:nav.helpCenter')}</span>
            </Link>

            <Link
              to="/settings"
              role="menuitem"
              tabIndex={0}
              onClick={close}
              className={menuItemClass}
            >
              <Settings size={18} className="text-gray-400" />
              <span>{t('menuSettings')}</span>
            </Link>

            <button
              type="button"
              role="menuitem"
              tabIndex={0}
              onClick={() => {
                close();
                handleSignOut();
              }}
              className={`${menuItemClass} hover:bg-red-50 hover:text-red-600 focus:bg-red-50 focus:text-red-600`}
            >
              <LogOut size={18} className="text-gray-400" />
              <span>{t('signOut')}</span>
            </button>
          </div>
        </div>
      )}

      {editorOpen && currentUser && (
        <ProfileEditorModal user={currentUser} onClose={() => setEditorOpen(false)} />
      )}
    </div>
  );
}

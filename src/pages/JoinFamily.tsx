import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';

/**
 * Child join entry flow — UX only.
 *
 * PLACEHOLDER BOUNDARY: this page intentionally performs NO backend calls,
 * creates NO child identity, and writes NO join request or family membership.
 * "Continue" validates locally and shows a temporary informational screen.
 */
export function JoinFamily() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();

  const [familyCode, setFamilyCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!familyCode.trim() || !username.trim() || !password || !confirmPassword) {
      setError(t('auth:joinFieldsRequired'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth:passwordsDoNotMatch'));
      return;
    }

    // No network request. No membership write. Informational screen only.
    setPassword('');
    setConfirmPassword('');
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {submitted ? (
            <div>
              <h2 className="text-2xl font-extrabold text-gray-900">{t('auth:parentApprovalRequired')}</h2>
              <p className="mt-3 text-sm text-gray-600">{t('auth:parentApprovalBody')}</p>
              <div className="mt-6">
                <Button type="button" fullWidth onClick={() => navigate('/login')}>
                  {t('auth:backToSignIn')}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <h2 className="text-2xl font-extrabold text-gray-900">{t('auth:joinYourFamily')}</h2>
              <p className="mt-2 text-sm text-gray-600">{t('auth:joinFamilyDescription')}</p>

              {error && (
                <div role="alert" className="mt-4 text-red-500 text-sm">
                  {error}
                </div>
              )}

              <form className="mt-6 space-y-6" onSubmit={handleSubmit} noValidate>
                <div>
                  <label htmlFor="join-family-code" className="block text-sm font-medium text-gray-700">{t('auth:familyCode')}</label>
                  <div className="mt-1">
                    <input
                      id="join-family-code"
                      type="text"
                      autoComplete="off"
                      value={familyCode}
                      onChange={e => setFamilyCode(e.target.value)}
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="join-username" className="block text-sm font-medium text-gray-700">{t('auth:username')}</label>
                  <div className="mt-1">
                    <input
                      id="join-username"
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="join-password" className="block text-sm font-medium text-gray-700">{t('auth:createPassword')}</label>
                  <div className="mt-1">
                    <input
                      id="join-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="join-confirm-password" className="block text-sm font-medium text-gray-700">{t('auth:confirmPassword')}</label>
                  <div className="mt-1">
                    <input
                      id="join-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  </div>
                </div>

                <Button type="submit" fullWidth>
                  {t('auth:continue')}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <Link to="/login" className="text-sm font-medium text-primary-600 hover:text-primary-500">
                  {t('auth:backToSignIn')}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

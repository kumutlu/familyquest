import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { signUp, signInWithGoogle } from '../lib/api';
import { useStore } from '../store/useStore';

export function Signup() {
  const { t } = useTranslation(['auth', 'common']);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const navigate = useNavigate();
  const authStatus = useStore(state => state.authStatus);

  // Once Firebase Auth reports the user as authenticated, the AppLayout route
  // guard performs the redirect to the correct protected route.
  useEffect(() => {
    if (authStatus === 'authenticated') {
      navigate('/', { replace: true });
    }
  }, [authStatus, navigate]);

  if (authStatus === 'authenticated') {
    return null;
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    setError('');
    try {
      await signUp(email, password, name);
      // Do not navigate here. The route guard redirects once auth is ready.
    } catch (err: any) {
      setError(err.message);
      setSigningIn(false);
    }
  };

  const handleGoogleSignup = async () => {
    setSigningIn(true);
    setError('');
    try {
      await signInWithGoogle();
      // Do not navigate here. The route guard redirects once auth is ready.
    } catch (err: any) {
      setError(err.message);
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h2 className="mt-6 text-3xl font-extrabold text-gray-900">{t('auth:createParentAccount')}</h2>
        <p className="mt-2 text-sm text-gray-600">{t('auth:createParentSubtitle')}</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSignup}>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('auth:displayName')}</label>
              <div className="mt-1">
                <input type="text" required value={name} onChange={e => setName(e.target.value)} className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">{t('auth:emailAddress')}</label>
              <div className="mt-1">
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">{t('auth:password')}</label>
              <div className="mt-1">
                <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
              </div>
            </div>

            {error && <div role="alert" className="mb-4 text-red-500 text-sm">{error}</div>}

            <Button type="submit" fullWidth disabled={signingIn}>
              {signingIn ? t('auth:signingIn') : t('auth:signUp')}
            </Button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">{t('auth:orContinueWith')}</span>
              </div>
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={handleGoogleSignup}
                disabled={signingIn}
                className="w-full flex items-center justify-center gap-3 px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-60"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {t('auth:signInWithGoogle')}
              </button>
            </div>
          </div>

          <div className="mt-6 text-center">
            <Link to="/login" className="text-sm font-medium text-primary-600 hover:text-primary-500">{t('auth:hasAccount')} {t('auth:signIn')}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
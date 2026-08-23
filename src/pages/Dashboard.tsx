import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLoader } from '../components/ui/PageLoader';
import { useStore } from '../store/useStore';
import { isParentRole } from '../lib/roles';
import { ParentLivingHome } from '../components/home/ParentLivingHome';
import { ChildLivingHome } from '../components/home/ChildLivingHome';
import { markStartupStage } from '../startupDiagnostics';

/**
 * Home route — Queki v2.
 *
 * Role routing only: parents get the Parent Living Home ("what matters right
 * now?"), children get the Child Living Home (personal state + focus). All
 * former dashboard content (activity feed, reversal history, summary card grid)
 * remains available on its own routes or behind focused sheets — never as the
 * primary Home presentation.
 */
export function Dashboard() {
  useEffect(() => { markStartupStage('DASHBOARD_FIRST_RENDER'); }, []);
  const { t } = useTranslation('dashboard');
  const { currentUser, loading } = useStore();

  if (loading || !currentUser) return <PageLoader label={t('loading')} />;

  if (isParentRole(currentUser.role)) {
    return <ParentLivingHome />;
  }

  return <ChildLivingHome />;
}

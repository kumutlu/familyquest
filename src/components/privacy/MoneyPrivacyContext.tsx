import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../../store/useStore';
import { maskFormattedWalletMoney } from './walletMoneyMask';

type MoneyPrivacyContextValue = {
  isMoneyHidden: boolean;
  toggleMoneyPrivacy: () => void;
  maskFormattedMoney: (value: string) => string;
};

const MoneyPrivacyContext = createContext<MoneyPrivacyContextValue | null>(null);
const storageKey = (userId: string) => `queki.moneyPrivacy:${userId}`;

function readMoneyPrivacy(userId: string | null | undefined): boolean {
  if (!userId || typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(storageKey(userId)) === 'true';
  } catch {
    return false;
  }
}

export function MoneyPrivacyProvider({ children }: { children: ReactNode }) {
  const userId = useStore(state => state.currentUser?.id) as string | null | undefined;
  const [isMoneyHidden, setIsMoneyHidden] = useState(() => readMoneyPrivacy(userId));

  useEffect(() => {
    setIsMoneyHidden(readMoneyPrivacy(userId));
  }, [userId]);

  const toggleMoneyPrivacy = useCallback(() => {
    setIsMoneyHidden(previous => {
      const next = !previous;

      if (userId && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(storageKey(userId), String(next));
        } catch {
          // Privacy is presentation-only; an unavailable storage API must not block the toggle.
        }
      }

      return next;
    });
  }, [userId]);

  const maskFormattedMoney = useCallback((value: string) => maskFormattedWalletMoney(value), []);
  const value = useMemo(
    () => ({ isMoneyHidden, toggleMoneyPrivacy, maskFormattedMoney }),
    [isMoneyHidden, toggleMoneyPrivacy, maskFormattedMoney],
  );

  return <MoneyPrivacyContext.Provider value={value}>{children}</MoneyPrivacyContext.Provider>;
}

export function useMoneyPrivacy(): MoneyPrivacyContextValue {
  const context = useContext(MoneyPrivacyContext);
  if (!context) throw new Error('useMoneyPrivacy must be used within a MoneyPrivacyProvider');
  return context;
}

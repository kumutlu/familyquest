import { Fragment } from 'react';
import { MoneyValue } from './MoneyValue';
import { useMoneyPrivacy } from './MoneyPrivacyContext';
import { isWalletMoneyToken, splitWalletMoneyText } from './walletMoneyMask';

export function WalletMoneyText({ children }: { children: string }) {
  const { isMoneyHidden } = useMoneyPrivacy();
  if (!isMoneyHidden) return <>{children}</>;

  return (
    <>
      {splitWalletMoneyText(children).map((part, index) => (
        isWalletMoneyToken(part)
          ? <MoneyValue key={`${part}-${index}`}>{part}</MoneyValue>
          : <Fragment key={`${part}-${index}`}>{part}</Fragment>
      ))}
    </>
  );
}

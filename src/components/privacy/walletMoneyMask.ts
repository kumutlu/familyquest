const walletMoneyTokenSource = String.raw`[-+]?(?:(?:£|\$|€|₺)\s*\d[\d.,]*|(?:GBP|USD|EUR|TRY)\s+\d[\d.,]*|\d[\d.,]*\s*(?:£|\$|€|₺|GBP|USD|EUR|TRY))`;

function walletMoneyTokenPattern(): RegExp {
  return new RegExp(`(${walletMoneyTokenSource})`, 'giu');
}

const exactWalletMoneyToken = new RegExp(`^${walletMoneyTokenSource}$`, 'iu');

const currencyContextPattern = /(GBP|USD|EUR|TRY|£|\$|€|₺)/iu;

/**
 * Keep the source currency meaningful without retaining any amount digits or
 * revealing the original amount's magnitude/precision.
 */
export function maskFormattedWalletMoney(value: string): string {
  const currencyContext = value.match(currencyContextPattern)?.[0];
  if (!currencyContext) return '••••';

  const normalizedContext = /^[a-z]{3}$/iu.test(currencyContext)
    ? currencyContext.toUpperCase()
    : currencyContext;
  const separator = /^[A-Z]{3}$/u.test(normalizedContext) ? ' ' : '';
  return `${normalizedContext}${separator}••••`;
}

export function maskWalletMoneyText(value: string, _legacyMask?: string): string {
  return value.replace(walletMoneyTokenPattern(), token => maskFormattedWalletMoney(token));
}

export function splitWalletMoneyText(value: string): string[] {
  return value.split(walletMoneyTokenPattern());
}

export function isWalletMoneyToken(value: string): boolean {
  return exactWalletMoneyToken.test(value);
}

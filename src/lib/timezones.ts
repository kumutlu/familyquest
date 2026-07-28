export interface TimezoneOption {
  value: string;
  label: string;
}

const FALLBACK_TIMEZONES = [
  'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Brussels',
  'Europe/Vienna', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul',
  'Europe/Moscow', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Toronto', 'America/Vancouver',
  'America/Mexico_City', 'America/Sao_Paulo', 'Asia/Dubai',
  'Asia/Riyadh', 'Asia/Jerusalem', 'Asia/Kolkata', 'Asia/Singapore',
  'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane',
  'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
] as const;

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function labelFor(value: string, locale: string): string {
  const [region, ...parts] = value.split('/');
  const city = parts.join(' / ').replaceAll('_', ' ');
  let regionLabel = region;
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: 'region' });
    const regionCodes: Record<string, string> = {
      Africa: '002', America: '019', Asia: '142', Australia: 'AU',
      Europe: '150', Pacific: '009', Atlantic: '001', Indian: '034',
    };
    regionLabel = displayNames.of(regionCodes[region]) || region;
  } catch {
    // The readable IANA region remains a safe fallback.
  }
  return city ? `${regionLabel} — ${city}` : regionLabel;
}

export function getTimezoneOptions(locale = 'en', currentValue?: string): TimezoneOption[] {
  let values: string[] = [];
  try {
    const supported = (Intl as typeof Intl & {
      supportedValuesOf?: (key: 'timeZone') => string[];
    }).supportedValuesOf;
    values = supported ? supported('timeZone') : [];
  } catch {
    values = [];
  }
  const combined = new Set(values.length > 0 ? values : FALLBACK_TIMEZONES);
  FALLBACK_TIMEZONES.forEach(value => combined.add(value));
  if (currentValue && isValidTimezone(currentValue)) combined.add(currentValue);
  return [...combined]
    .filter(isValidTimezone)
    .map(value => ({ value, label: labelFor(value, locale) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

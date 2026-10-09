import type { SystemExternalInfo } from '../../../shared/edsm';
import type { SystemSurvey } from '../../../shared/history';
import { formatCredits } from '../journal/format';
import type { DataRow, Tone } from './DataTable';

/** What a row that needs EDSM shows while it hasn't answered, can't be reached, or has no data. */
function edsmGap(info: SystemExternalInfo | undefined): string {
  if (!info) return '…';
  if (info.status === 'unavailable') return 'EDSM offline';
  if (info.status === 'unknown') return 'No EDSM data';
  return '—';
}

/** How dangerous the system is, from ships EDSM users lost there in the last day. */
export function threatRow(info: SystemExternalInfo | undefined): DataRow {
  const label = 'Threat';
  const deaths = info?.deaths;
  if (!deaths) return { label, value: edsmGap(info) };
  const [level, tone]: [string, Tone | undefined] =
    deaths.day >= 5
      ? ['High', 'danger']
      : deaths.day > 0
        ? ['Medium', 'warning']
        : ['Low', undefined];
  return {
    label,
    value: level,
    tone,
    title: `${deaths.day} ships lost in the last 24 hours, ${deaths.week} this week (EDSM)`,
  };
}

export function securityRow(security: string | undefined): DataRow {
  const tone: Tone | undefined =
    security === undefined
      ? undefined
      : /anarchy|lawless/i.test(security)
        ? 'danger'
        : /low/i.test(security)
          ? 'warning'
          : undefined;
  return { label: 'Security', value: security || '—', tone };
}

/** What this system's unsold scan data is worth, so far. */
export function systemValueRow(survey: SystemSurvey | undefined): DataRow | undefined {
  const pending = survey?.bodies.filter((body) => body.status === 'pending') ?? [];
  const value = pending.reduce((sum, body) => sum + body.value, 0);
  if (value <= 0) return undefined;
  return {
    label: 'System value',
    value: formatCredits(value),
    title: `Estimated, from ${pending.length} unsold ${pending.length === 1 ? 'scan' : 'scans'}`,
  };
}

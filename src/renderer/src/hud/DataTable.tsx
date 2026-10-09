import type { ReactNode } from 'react';

/** Values worth acting on are bright; ones that need attention are amber, danger red. */
export type Tone = 'good' | 'warning' | 'danger';

export interface DataRow {
  label: string;
  value: ReactNode;
  tone?: Tone;
  /** More detail, shown on hover. */
  title?: string;
}

/** The class each tone paints a value with. */
export function toneClass(tone: Tone | undefined): string | undefined {
  return tone === 'warning' ? 'warn' : tone;
}

/** Label on the left, value on the right, a rule between rows. */
export function DataTable({
  rows,
  className = 'kv',
}: {
  rows: readonly DataRow[];
  className?: string;
}) {
  return (
    <dl className={className}>
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd className={toneClass(row.tone)} title={row.title}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

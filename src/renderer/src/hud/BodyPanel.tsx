import type { SurveyBody, SystemSurvey } from '../../../shared/history';
import { type BioLine, bioBodies } from '../../../shared/mission';
import { countSignals, shortSignal } from '../../../shared/signals';
import { formatCompact, formatNumber } from '../journal/format';
import { Icon } from './Icon';
import { ICONS } from './icons';
import { Pips } from './Pips';

/**
 * The body the commander is on or near, shown under the current system: what it is, what is
 * notable about it, and the life found on it. A body the survey hasn't scanned gets its name.
 */
export function BodyPanel({
  bodyName,
  survey,
}: {
  bodyName: string;
  survey: SystemSurvey | undefined;
}) {
  const body = survey?.bodies.find((candidate) => candidate.name === bodyName);
  const name = survey ? shortBodyName(bodyName, survey.systemName) : bodyName;
  const scanned = body !== undefined && body.kind !== undefined;
  const tags = body && scanned ? bodyTags(body) : [];
  const bio = bioBodies(survey).find((candidate) => candidate.body.name === bodyName);
  return (
    <section className="side-block" aria-label={`Current body: ${bodyName}`}>
      <div className="body-title">
        <Icon src={ICONS.planet} className="icon body-logo" />
        <div className="grow">
          <div className="body-name">
            <span className="ellip" title={bodyName}>
              {name}
            </span>
            <Icon src={ICONS.marker} className="icon here" />
          </div>
          <div className="body-sub">{scanned ? bodyLine(body) : 'Not scanned'}</div>
        </div>
      </div>
      {tags.length > 0 && (
        <div className="tags" style={{ marginBottom: 10 }}>
          {tags.map((tag) => (
            <span key={tag} className="tag ghost">
              {tag}
            </span>
          ))}
        </div>
      )}
      {bio && bio.lines.length > 0 && (
        <table className="tbl compact">
          <thead>
            <tr>
              <th>
                {bio.body.bioSignals} biological {bio.body.bioSignals === 1 ? 'signal' : 'signals'}
              </th>
              <th className="v">Samples</th>
              <th className="v">Value</th>
            </tr>
          </thead>
          <tbody>
            {bio.lines.map((line) => (
              <BioRow key={line.key} line={line} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function BioRow({ line }: { line: BioLine }) {
  const done = line.progress === 'analysed' || line.status === 'sold';
  const guess = line.status === 'unsampled' || line.status === 'predicted';
  const likely =
    line.status === 'unsampled' && line.candidates?.length === 1 ? undefined : line.candidates;
  return (
    <tr className={done ? 'past' : undefined}>
      <td title={likely?.map((candidate) => candidate.name).join(', ')}>
        {guess ? (
          <>
            <span className="dim">{line.name}</span>
            {likely && likely.length > 0 && (
              <span className="faint"> · {shortCandidate(likely[0]!.name)}?</span>
            )}
          </>
        ) : (
          line.name
        )}
      </td>
      <td className="v">{line.status === 'predicted' ? '' : <Pips progress={line.progress} />}</td>
      <td className="v">
        {line.minValue === undefined ? (
          <span className="dim">?</span>
        ) : guess ? (
          <span className="dim">~{formatValueRange(line.minValue, line.maxValue)}</span>
        ) : (
          formatCompact(line.minValue)
        )}
      </td>
    </tr>
  );
}

/** "Bacterium Vesicula" → "Vesicula": the genus is already on the line. */
function shortCandidate(name: string): string {
  return name.split(' ').slice(1).join(' ') || name;
}

function formatValueRange(min: number, max: number | undefined): string {
  return max === undefined || max === min
    ? formatCompact(min)
    : `${formatCompact(min)}–${formatCompact(max)}`;
}

/** "Rocky ice · 2.52 g · 259 ls". */
function bodyLine(body: SurveyBody): string {
  return [
    typeLabel(body),
    body.gravity !== undefined && `${formatNumber(body.gravity / 9.80665, 2)} g`,
    body.distanceLs !== undefined && `${formatNumber(body.distanceLs, 0)} ls`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What is notable about a body: firsts, what it could become, and what else is on it. */
function bodyTags(body: SurveyBody): string[] {
  const tags: string[] = [];
  if (body.firstDiscovery) tags.push('First discovery');
  if (body.firstFootfall === true) tags.push('First footfall');
  if (body.terraformable) tags.push('Terraformable');
  if (body.mapped) tags.push(body.mappedEfficiently ? 'Mapped efficiently' : 'Mapped');
  const signals = countSignals([body], (type) => !/biolog|mining/i.test(type));
  for (const [type, count] of signals) tags.push(`${shortSignal(type)} ${count}`);
  for (const record of body.records ?? []) tags.push(record);
  return tags;
}

/** "Alrai Sector MX-U c2-17 A 1" in that system → "A 1". */
export function shortBodyName(name: string, systemName: string): string {
  return name.startsWith(`${systemName} `) ? name.slice(systemName.length + 1) : name;
}

const PLANET_LABELS: Readonly<Record<string, string>> = {
  'high metal content body': 'HMC',
  'metal rich body': 'Metal-rich',
  'earthlike body': 'Earth-like world',
  'water world': 'Water world',
  'ammonia world': 'Ammonia world',
  'rocky body': 'Rocky',
  'icy body': 'Icy',
  'rocky ice body': 'Rocky ice',
  'water giant': 'Water giant',
};

/** "HMC", "Class II gas giant", "Class K star": a body's type as the side panel names it. */
export function typeLabel(body: SurveyBody): string | undefined {
  if (body.type === undefined) return undefined;
  if (body.kind === 'star') return `Class ${body.type} star`;
  const lower = body.type.toLowerCase();
  const gasGiant = /^sudarsky class (\w+) gas giant$/.exec(lower);
  if (gasGiant) return `Class ${gasGiant[1]!.toUpperCase()} gas giant`;
  return PLANET_LABELS[lower] ?? body.type;
}

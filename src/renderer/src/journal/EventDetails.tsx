import type { ShipLoss } from '../../../shared/history';
import type { JournalEvent } from '../../../shared/journal';
import {
  type PlottedRoute,
  type RouteProgress,
  routeLengthLy,
  type RouteSystem,
} from '../../../shared/nav-routes';
import { CopyButton } from '../hud/CopyButton';
import {
  displayFields,
  formatCredits,
  formatDateTime,
  formatList,
  formatNumber,
  formatValue,
  isGameSymbol,
} from './format';
import { lossTotal } from './losses';
import { describePosition, describeRoute, routeContext } from './route-notes';
import { RouteSystemList } from './RouteSystemList';

interface EventDetailsProps {
  event: JournalEvent;
  /** Recorded routes, oldest first. */
  routes: readonly PlottedRoute[];
  /** What a death cost, for a `Died` event the history tracker has priced. */
  loss?: ShipLoss;
}

/** Every field of an event, labelled and formatted for reading, plus the route it was part of. */
export function EventDetails({ event, routes, loss }: EventDetailsProps) {
  const hasFields = displayFields(event, true).length > 0;
  const route = routeContext(event, routes);
  return (
    <div className="card-body">
      {hasFields ? (
        <FieldList eventName={event.event} record={event} isEvent />
      ) : (
        !route && !loss && <p className="card-note">No further details.</p>
      )}
      {loss && <LossDetails loss={loss} />}
      {route && <RouteDetails eventName={event.event} progress={route} />}
      <div className="card-foot">
        <code title={formatDateTime(event.timestamp)}>{event.event}</code>
        <span className="sp" />
        <button
          type="button"
          className="link"
          title="The journal line, as the game wrote it"
          onClick={() => void window.edssi.clipboard.writeText(toJson(event))}
        >
          Copy JSON
        </button>
      </div>
    </div>
  );
}

/** The event as JSON; the journal's large ids are bigints, written out as the numbers they are. */
function toJson(event: JournalEvent): string {
  return JSON.stringify(event, (_key, value: unknown) =>
    typeof value === 'bigint' ? `__big__${value}__` : value,
  ).replaceAll(/"__big__(\d+)__"/g, '$1');
}

/** What the destroyed ship was carrying that the commander hadn't cashed in. */
function LossDetails({ loss }: { loss: ShipLoss }) {
  const { cartographics, exobiology } = loss;
  return (
    <section className="loss" aria-label="Lost with the ship">
      <p className="loss-head">
        <strong>Lost with the ship{loss.systemName ? ` in ${loss.systemName}` : ''}</strong>
        <span>{formatCredits(lossTotal(loss))}</span>
      </p>
      <dl className="kv sm">
        {cartographics.bodies > 0 && (
          <div>
            <dt>Cartographic data</dt>
            <dd>
              {formatCredits(cartographics.value)} · {formatNumber(cartographics.bodies, 0)}{' '}
              {cartographics.bodies === 1 ? 'body' : 'bodies'} in{' '}
              {formatNumber(cartographics.systems, 0)}{' '}
              {cartographics.systems === 1 ? 'system' : 'systems'}
            </dd>
          </div>
        )}
        {exobiology.species > 0 && (
          <div>
            <dt>Exobiology data</dt>
            <dd>
              {formatCredits(exobiology.value)} · {formatNumber(exobiology.species, 0)}{' '}
              {exobiology.species === 1 ? 'sample' : 'samples'}
            </dd>
          </div>
        )}
        {loss.bounties > 0 && (
          <div>
            <dt>Bounty vouchers</dt>
            <dd>{formatCredits(loss.bounties)}</dd>
          </div>
        )}
        {loss.combatBonds > 0 && (
          <div>
            <dt>Combat bonds</dt>
            <dd>{formatCredits(loss.combatBonds)}</dd>
          </div>
        )}
      </dl>
      {loss.notable.length > 0 && (
        <ul className="loss-items">
          {loss.notable.map((item) => (
            <li key={`${item.kind}-${item.name}-${item.bodyName ?? ''}`}>
              <span>{item.name}</span>
              <span className="muted">
                {[item.kind === 'organic' ? item.bodyName : undefined, item.systemName]
                  .filter((part) => part !== undefined)
                  .join(' · ')}
              </span>
              <span>{formatCredits(item.value)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="card-note">
        Estimated from EDSSI's own ledger: what hadn't been sold when the ship was destroyed.
      </p>
    </section>
  );
}

function RouteDetails({ eventName, progress }: { eventName: string; progress: RouteProgress }) {
  const { route, position } = progress;
  const { systems } = route;
  return (
    <section className="jroute" aria-label="Route">
      <p className="jroute-head">
        <strong>{systems ? describeRoute(systems) : 'Route'}</strong>
        {systems && eventName !== 'NavRoute' && (
          <span>{positionText(eventName, systems, position)}</span>
        )}
      </p>
      {systems ? (
        <RouteSystemList systems={systems} position={position} />
      ) : (
        <p className="card-note">
          Systems not recorded: the route was replaced or cleared before EDSSI could read
          NavRoute.json.
        </p>
      )}
      <p className="card-note">
        Plotted {formatDateTime(route.plottedAt)}
        {route.clearedAt && ` · cleared ${formatDateTime(route.clearedAt)}`}
      </p>
    </section>
  );
}

/** "jump 4 of 12 · 312 ly to go", "targets jump 5 of 12", "off route"… */
function positionText(
  eventName: string,
  systems: readonly RouteSystem[],
  position: number | undefined,
): string {
  const where = describePosition(systems, position);
  if (position === undefined || position === 0) return where;
  if (eventName === 'FSDTarget') return `targets ${where}`;
  const left = routeLengthLy(systems, position);
  return left > 0 ? `${where} · ${formatNumber(left, 1)} ly to go` : `${where} · arrived`;
}

interface FieldListProps {
  eventName: string;
  record: object;
  isEvent?: boolean;
}

function FieldList({ eventName, record, isEvent = false }: FieldListProps) {
  return (
    <dl className="kv sm">
      {displayFields(record, isEvent).map((field) => (
        <div key={field.key}>
          <dt>{field.label}</dt>
          <dd title={field.raw}>
            <FieldValue eventName={eventName} name={field.key} value={field.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FieldValue({
  eventName,
  name,
  value,
}: {
  eventName: string;
  name: string;
  value: unknown;
}) {
  if (Array.isArray(value)) {
    if (!value.some(isObject)) return <>{formatList(eventName, name, value)}</>;
    return (
      <ul className="items">
        {value.map((item, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- journal array items have no identity.
          <li key={index}>
            {isObject(item) ? (
              <FieldList eventName={eventName} record={item} />
            ) : (
              formatValue(eventName, name, item)
            )}
          </li>
        ))}
      </ul>
    );
  }
  if (isObject(value)) return <FieldList eventName={eventName} record={value} />;

  const text = formatValue(eventName, name, value);
  if (isGameSymbol(value)) return <code className="symbol">{text}</code>;
  if (isSystemField(name) && typeof value === 'string' && value !== '') {
    return (
      <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
        {text}
        <CopyButton text={value} />
      </span>
    );
  }
  return <>{text}</>;
}

/** Fields that hold a system's name, wherever they turn up in an event. */
const SYSTEM_FIELDS = new Set(['StarSystem', 'SystemName', 'System', 'DestinationSystem']);

function isSystemField(name: string): boolean {
  return SYSTEM_FIELDS.has(name);
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

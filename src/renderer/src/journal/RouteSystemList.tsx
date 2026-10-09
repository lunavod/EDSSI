import { distanceLy, type RouteSystem } from '../../../shared/nav-routes';
import { CopyButton } from '../hud/CopyButton';
import { StarClass } from '../hud/StarClass';
import { starBadge } from '../hud/system-facts';
import { formatNumber } from './format';

/** A route's systems in order, each with its star and leg length; `position` is highlighted. */
export function RouteSystemList({
  systems,
  position,
}: {
  systems: readonly RouteSystem[];
  position: number | undefined;
}) {
  return (
    <div className="scroll">
      <table className="tbl compact">
        <tbody>
          {systems.map((system, index) => (
            <tr
              key={String(system.SystemAddress)}
              className={index === position ? 'sel' : index < (position ?? 0) ? 'past' : undefined}
              aria-current={index === position ? 'step' : undefined}
            >
              <td>{index}</td>
              <td style={{ width: 40 }}>
                <StarClass badge={starBadge(system.StarClass, undefined)} />
              </td>
              <td style={{ width: '100%' }}>
                <span className="row" style={{ gap: 6 }}>
                  {system.StarSystem}
                  <CopyButton text={system.StarSystem} />
                </span>
              </td>
              <td className="v">
                {index > 0 && `${formatNumber(distanceLy(systems[index - 1]!, system))} ly`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import type { ShipLoss } from '../../../shared/history';
import type { JournalEvent } from '../../../shared/journal';
import { formatCredits } from './format';
import { join } from './summaries';

/** The loss recorded for a `Died` line, if the history tracker got that far. */
export function lossFor(event: JournalEvent, losses: readonly ShipLoss[]): ShipLoss | undefined {
  if (event.event !== 'Died') return undefined;
  return losses.find((loss) => loss.timestamp === event.timestamp);
}

/** What the death cost, in one line: only the parts that cost anything. */
export function summariseLoss(loss: ShipLoss): string | undefined {
  const { cartographics, exobiology } = loss;
  return join(
    cartographics.value > 0 &&
      `${formatCredits(cartographics.value)} of scan data (${countOf(cartographics.bodies, 'body', 'bodies')})`,
    exobiology.value > 0 &&
      `${formatCredits(exobiology.value)} of samples (${countOf(exobiology.species, 'species', 'species')})`,
    loss.bounties > 0 && `${formatCredits(loss.bounties)} in bounty vouchers`,
    loss.combatBonds > 0 && `${formatCredits(loss.combatBonds)} in combat bonds`,
  );
}

/** Everything the death cost, in credits. */
export function lossTotal(loss: ShipLoss): number {
  return loss.cartographics.value + loss.exobiology.value + loss.bounties + loss.combatBonds;
}

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

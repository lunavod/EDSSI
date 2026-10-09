/**
 * How much a journal event moves the commander's credit balance by, for anything that keeps a
 * running total from `LoadGame`'s snapshot (the HUD's `Overview.credits`, the activity tracker's
 * `CommanderActivity.credits`). `Status.json`'s own `Balance` is more current when it's present,
 * but the game only writes it on foot, so most of a session runs on this instead.
 */

import type { JournalEvent } from './journal';

export function creditsDelta(event: JournalEvent): number {
  switch (event.event) {
    case 'SellExplorationData':
    case 'MultiSellExplorationData':
      return event.TotalEarnings;
    case 'SellOrganicData':
      return event.BioData.reduce((sum, sold) => sum + sold.Value + sold.Bonus, 0);
    case 'MarketSell':
      return event.TotalSale;
    case 'MarketBuy':
      return -event.TotalCost;
    case 'RedeemVoucher':
      return event.Amount;
    case 'MissionCompleted':
      return event.Reward ?? 0;
    case 'SearchAndRescue':
      return event.Reward;
    case 'Bounty':
      return event.TotalReward ?? event.Reward ?? 0;
    case 'FactionKillBond':
    case 'CapShipBond':
      return event.Reward;
    case 'ShipyardSell':
    case 'SellShipOnRebuy':
      return event.ShipPrice;
    case 'ModuleSell':
      return event.SellPrice;
    case 'ShipyardBuy':
      return (event.SellPrice ?? 0) - event.ShipPrice;
    case 'ModuleBuy':
      return (event.SellPrice ?? 0) - event.BuyPrice;
    case 'Repair':
    case 'RepairAll':
      return -event.Cost;
    case 'RefuelAll':
    case 'RefuelPartial':
      return -event.Cost;
    case 'BuyAmmo':
    case 'RestockVehicle':
      return -event.Cost;
    case 'Resurrect':
      return -event.Cost;
    case 'PayFines':
    case 'PayBounties':
      return -event.Amount;
    case 'BuyExplorationData':
      return -event.Cost;
    default:
      return 0;
  }
}

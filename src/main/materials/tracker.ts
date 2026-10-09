import type { OwnedModule, OwnedShip } from '../../shared/build-import';
import { type EngineerStanding, engineerKey } from '../../shared/crafting';
import type { JournalEvent, JournalEventMap } from '../../shared/journal';
import {
  type CraftRecord,
  matchRecipe,
  type Recipe,
  type RecipeKind,
  sameIngredients,
} from '../../shared/materials';

/** Crafts kept per commander; older ones drop off. */
export const HISTORY_LIMIT = 200;

type Counts = Map<string, number>;

interface CommanderRecord {
  name?: string;
  /** Raw, manufactured and encoded materials. */
  materials: Counts;
  cargo: Counts;
  locker: Counts;
  /** When the cargo and the locker were last read in full, so an older companion file is ignored. */
  cargoAt?: string;
  lockerAt?: string;
  /** Oldest first. */
  history: CraftRecord[];
  /** By `engineerKey`. */
  engineers: Map<string, EngineerStanding>;
  /** Each ship's last `Loadout`, by ShipID, for comparing a build with. */
  ships: Map<number, Omit<OwnedShip, 'current'>>;
  currentShip?: number;
}

/**
 * Follows the journal from the very first file and keeps, per commander, what they carry to craft
 * with and what they have crafted. Ship materials are counted from the `Materials` list at login
 * and every change after it; cargo and the ship locker are read whole whenever the game writes them.
 */
export class MaterialsTracker {
  readonly #commanders = new Map<string, CommanderRecord>();
  #commander: CommanderRecord = this.#commanderFor('');
  #version = 0;

  get version(): number {
    return this.#version;
  }

  /** Applies an event; returns whether it could have changed the snapshot. */
  apply(event: JournalEvent): boolean {
    const changed = this.#apply(event);
    if (changed) this.#version++;
    return changed;
  }

  /** Applies a companion file the game rewrote; ignored when the journal already has newer. */
  applyCompanion(event: JournalEventMap['Cargo'] | JournalEventMap['ShipLocker']): boolean {
    const changed = event.event === 'Cargo' ? this.#cargo(event) : this.#locker(event);
    if (changed) this.#version++;
    return changed;
  }

  get commander(): string | undefined {
    return this.#commander.name;
  }

  inventory(): Record<string, number> {
    const inventory: Record<string, number> = {};
    const { materials, cargo, locker } = this.#commander;
    for (const counts of [materials, cargo, locker]) {
      for (const [name, count] of counts) inventory[name] = (inventory[name] ?? 0) + count;
    }
    return inventory;
  }

  /** Newest first. */
  history(): CraftRecord[] {
    return this.#commander.history.toReversed();
  }

  /** The commander's ships as last fitted, the one flown marked. */
  ships(): OwnedShip[] {
    const { ships, currentShip } = this.#commander;
    return [...ships.values()].map((ship) => ({ ...ship, current: ship.shipId === currentShip }));
  }

  /** Every engineer the commander has heard of, and how far along they are with each. */
  engineers(): EngineerStanding[] {
    return [...this.#commander.engineers.values()];
  }

  #apply(event: JournalEvent): boolean {
    const { materials } = this.#commander;
    switch (event.event) {
      case 'Commander':
        this.#commander = this.#commanderFor(event.FID, event.Name);
        return true;
      case 'LoadGame':
        this.#commander = this.#commanderFor(event.FID, event.Commander);
        return true;

      case 'Materials':
        materials.clear();
        for (const item of [...event.Raw, ...event.Manufactured, ...event.Encoded]) {
          add(materials, item.Name, item.Count);
        }
        return true;
      case 'MaterialCollected':
        add(materials, event.Name, event.Count);
        return true;
      case 'MaterialDiscarded':
      case 'ScientificResearch':
        add(materials, event.Name, -event.Count);
        return true;
      case 'MaterialTrade':
        add(materials, event.Paid.Material, -event.Paid.Quantity);
        add(materials, event.Received.Material, event.Received.Quantity);
        return true;
      case 'MissionCompleted':
        if (!event.MaterialsReward?.length) return false;
        for (const reward of event.MaterialsReward) add(materials, reward.Name, reward.Count);
        return true;
      case 'EngineerContribution':
        // Commodities come out of the hold, which the next Cargo shows.
        if (event.Material === undefined) return false;
        add(materials, event.Material, -event.Quantity);
        return true;

      case 'Synthesis':
        this.#spend(event.Materials);
        this.#synthesis(event);
        return true;
      case 'EngineerCraft':
        this.#spend(event.Ingredients);
        this.#engineerCraft(event);
        return true;
      case 'TechnologyBroker':
        this.#spend(event.Materials);
        this.#technologyBroker(event);
        return true;
      case 'UpgradeSuit':
      case 'UpgradeWeapon':
        // Resources come out of the locker, which the next ShipLocker shows.
        this.#upgrade(event);
        return true;

      case 'EngineerProgress':
        return this.#engineerProgress(event);

      case 'Loadout':
        this.#loadout(event);
        return false;
      case 'ShipyardSwap':
        this.#commander.currentShip = event.ShipID;
        return false;
      case 'ShipyardSell':
        this.#commander.ships.delete(event.SellShipID);
        return false;

      case 'Cargo':
        return this.#cargo(event);
      case 'ShipLocker':
        return this.#locker(event);
      default:
        return false;
    }
  }

  /** Takes a craft's materials; commodities and resources are left to the next full list. */
  #spend(used: readonly { Name: string; Count: number }[]): void {
    const { materials } = this.#commander;
    for (const item of used) {
      if (materials.has(item.Name.toLowerCase())) add(materials, item.Name, -item.Count);
    }
  }

  /** The whole list at login, then one engineer at a time (with no `Progress` for a new rank). */
  #engineerProgress(event: JournalEventMap['EngineerProgress']): boolean {
    const { engineers } = this.#commander;
    const updates = event.Engineers ?? [event];
    let changed = false;
    for (const update of updates) {
      if (typeof update.Engineer !== 'string') continue;
      const name = update.Engineer.replace(/\s*'[^']*'\s*/g, ' ').trim();
      const key = engineerKey(name);
      const known = engineers.get(key);
      const progress = update.Progress ?? known?.progress ?? 'Unlocked';
      const rank = update.Rank ?? known?.rank;
      engineers.set(key, { name, progress, ...(rank !== undefined && { rank }) });
      changed = true;
    }
    return changed;
  }

  #loadout(event: JournalEventMap['Loadout']): void {
    const modules: OwnedModule[] = [];
    for (const module of Array.isArray(event.Modules) ? event.Modules : []) {
      if (typeof module.Slot !== 'string' || typeof module.Item !== 'string') continue;
      const engineering = module.Engineering;
      modules.push({
        slot: module.Slot,
        item: module.Item.toLowerCase(),
        ...(engineering && {
          blueprint: engineering.BlueprintName,
          level: engineering.Level,
          ...(engineering.ExperimentalEffect && { experimental: engineering.ExperimentalEffect }),
        }),
      });
    }
    this.#commander.currentShip = event.ShipID;
    this.#commander.ships.set(event.ShipID, {
      shipId: event.ShipID,
      ship: event.Ship.toLowerCase(),
      ...(event.ShipName && { name: event.ShipName }),
      modules,
    });
  }

  #cargo(event: JournalEventMap['Cargo']): boolean {
    // Without an inventory the line only says Cargo.json changed; the SRV's hold isn't the ship's.
    if (!event.Inventory || event.Vessel !== 'Ship') return false;
    const commander = this.#commander;
    if (commander.cargoAt !== undefined && event.timestamp < commander.cargoAt) return false;
    commander.cargoAt = event.timestamp;
    replace(commander.cargo, event.Inventory);
    return true;
  }

  #locker(event: JournalEventMap['ShipLocker']): boolean {
    if (!event.Items && !event.Components && !event.Data && !event.Consumables) return false;
    const commander = this.#commander;
    if (commander.lockerAt !== undefined && event.timestamp < commander.lockerAt) return false;
    commander.lockerAt = event.timestamp;
    replace(commander.locker, [
      ...(event.Items ?? []),
      ...(event.Components ?? []),
      ...(event.Data ?? []),
      ...(event.Consumables ?? []),
    ]);
    return true;
  }

  #synthesis(event: JournalEventMap['Synthesis']): void {
    const used = ingredients(event.Materials);
    const recipe = matchRecipe('synthesis', event.Name, used);
    this.#record(event.timestamp, 'synthesis', recipe, {
      name: recipe?.name ?? event.Name,
      ingredients: used,
    });
  }

  #engineerCraft(event: JournalEventMap['EngineerCraft']): void {
    const used = ingredients(event.Ingredients);
    const experimental = event.ApplyExperimentalEffect;
    const recipe = experimental
      ? matchRecipe('experimental', experimental, used)
      : matchRecipe(
          'engineering',
          event.BlueprintName,
          used,
          (candidate) => candidate.grade === event.Level,
        );
    const name = experimental
      ? (recipe?.name ?? event.ExperimentalEffect_Localised ?? experimental)
      : (recipe?.name ?? event.BlueprintName.replace(/_/g, ' '));
    this.#record(event.timestamp, experimental ? 'experimental' : 'engineering', recipe, {
      name,
      grade: experimental ? undefined : event.Level,
      detail: join(recipe?.group, event.Engineer),
      ingredients: used,
    });
  }

  #technologyBroker(event: JournalEventMap['TechnologyBroker']): void {
    const used = ingredients([...event.Materials, ...event.Commodities]);
    const unlocked = event.ItemsUnlocked[0];
    const recipe = matchRecipe('techbroker', unlocked?.Name, used);
    this.#record(event.timestamp, 'techbroker', recipe, {
      name: recipe?.name ?? unlocked?.Name_Localised ?? unlocked?.Name ?? 'Technology',
      detail: `${event.BrokerType} broker`,
      ingredients: used,
    });
  }

  #upgrade(event: JournalEventMap['UpgradeSuit'] | JournalEventMap['UpgradeWeapon']): void {
    const used = ingredients(event.Resources ?? []);
    const group = event.event === 'UpgradeSuit' ? 'Suit upgrades' : 'Weapon upgrades';
    const recipe = matchRecipe(
      'odyssey',
      undefined,
      used,
      (candidate) => candidate.group === group && candidate.grade === event.Class,
    );
    this.#record(event.timestamp, 'odyssey', recipe, {
      name: event.Name_Localised ?? recipe?.name ?? event.Name,
      grade: event.Class,
      detail: group.replace(/s$/, ''),
      ingredients: used,
    });
  }

  /** Adds a craft, folding it into the last one when it is the same thing made again. */
  #record(
    timestamp: string,
    kind: RecipeKind,
    recipe: Recipe | undefined,
    craft: Pick<CraftRecord, 'name' | 'detail' | 'grade' | 'ingredients'>,
  ): void {
    const history = this.#commander.history;
    const grade = craft.grade ?? recipe?.grade;
    const last = history.at(-1);
    if (
      last &&
      last.kind === kind &&
      last.recipe === recipe?.id &&
      last.name === craft.name &&
      last.detail === craft.detail &&
      last.grade === grade &&
      sameIngredients(last.ingredients, craft.ingredients)
    ) {
      last.count++;
      last.timestamp = timestamp;
      return;
    }
    history.push({
      timestamp,
      kind,
      ...(recipe && { recipe: recipe.id }),
      name: craft.name,
      ...(craft.detail && { detail: craft.detail }),
      ...(grade !== undefined && { grade }),
      count: 1,
      ingredients: craft.ingredients,
    });
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  }

  #commanderFor(fid: string, name?: string): CommanderRecord {
    let commander = this.#commanders.get(fid);
    if (!commander) {
      commander = {
        materials: new Map(),
        cargo: new Map(),
        locker: new Map(),
        history: [],
        engineers: new Map(),
        ships: new Map(),
      };
      this.#commanders.set(fid, commander);
    }
    if (name) commander.name = name;
    return commander;
  }
}

function add(counts: Counts, name: string, delta: number): void {
  const key = name.toLowerCase();
  const count = (counts.get(key) ?? 0) + delta;
  if (count > 0) counts.set(key, count);
  else counts.delete(key);
}

function replace(counts: Counts, items: readonly { Name: string; Count: number }[]): void {
  counts.clear();
  for (const item of items) add(counts, item.Name, item.Count);
}

function ingredients(items: readonly { Name: string; Count: number }[]): [string, number][] {
  return items.map((item) => [item.Name.toLowerCase(), item.Count]);
}

function join(...parts: (string | undefined)[]): string | undefined {
  const present = parts.filter(Boolean);
  return present.length > 0 ? present.join(' · ') : undefined;
}

import { describe, expect, it } from 'vitest';

import {
  blueprintByKey,
  type BlueprintTodo,
  blueprintModules,
  blueprintsFor,
  type CraftingTodo,
  type EngineerStanding,
  engineerInfo,
  engineerKey,
  engineerOptions,
  experimentalChoices,
  experimentalsFor,
  familyLabel,
  materialNeeds,
  maxGrade,
  plannedRolls,
  planTrades,
  recordSynthesis,
  reservedMaterials,
  rollsToMax,
  sanitizeTodo,
  suitableEngineer,
  synthesisByName,
  todoDone,
  todoEngineerOptions,
  todoEngineerRank,
  tradeOptions,
  tradeRate,
} from './crafting';
import { ENGINEERS, materialInfo } from './materials';

const FSD = 'engineering:fsd_longrange:frame-shift-drive';

/** Every engineer at rank 5, as the older tests take for granted. */
const RANK5: EngineerStanding[] = ENGINEERS.map((engineer) => ({
  name: engineer.name,
  progress: 'Unlocked',
  rank: 5,
}));

function fsd(patch: Partial<BlueprintTodo> = {}): BlueprintTodo {
  return { id: 'a', kind: 'blueprint', blueprint: FSD, from: 0, to: 5, targetRolls: 1, ...patch };
}

describe('blueprints', () => {
  it('gathers every grade of a blueprint for its module', () => {
    const blueprint = blueprintByKey(FSD)!;
    expect(blueprint.module).toBe('Frame Shift Drive');
    expect(blueprint.name).toBe('Increased FSD Range');
    expect(maxGrade(blueprint)).toBe(5);
    expect(blueprintModules()).toContain('Frame Shift Drive');
    expect(blueprintsFor('Frame Shift Drive').map((known) => known.key)).toContain(FSD);
    expect(experimentalsFor('Frame Shift Drive').map((recipe) => recipe.name)).toContain(
      'Deep Charge',
    );
  });
});

describe('reservedMaterials', () => {
  it('adds up the rolls left at each grade and the experimental', () => {
    const reserved = reservedMaterials(
      [fsd({ from: 3, targetRolls: 2, experimental: 'experimental:special_fsd_fuelcapacity' })],
      RANK5,
    );
    // At rank 5: G4 maxed in four rolls, G5 the two asked for, then Deep Charge once.
    expect(reserved).toMatchObject({
      manganese: 4,
      chemicaldistillery: 4,
      hyperspacetrajectories: 5,
      arsenic: 2,
      chemicalmanipulators: 2,
      dataminedwake: 2,
      disruptedwakeechoes: 5,
      galvanisingalloys: 3,
    });
  });

  it('counts syntheses by grade', () => {
    expect(
      reservedMaterials(
        [{ id: 's', kind: 'synthesis', synthesis: 'Limpets', counts: [3, 0, 0] }],
        RANK5,
      ),
    ).toEqual({ iron: 30, nickel: 30 });
  });
});

describe('recordSynthesis', () => {
  it('counts a synthesis down', () => {
    const todos: CraftingTodo[] = [
      { id: 's', kind: 'synthesis', synthesis: 'AFM Refill', counts: [1, 2, 0] },
    ];
    expect(recordSynthesis(todos, { synthesis: 'AFM Refill', grade: 2 })).toEqual([
      { id: 's', kind: 'synthesis', synthesis: 'AFM Refill', counts: [1, 1, 0] },
    ]);
    expect(recordSynthesis(todos, { synthesis: 'AFM Refill', grade: 3 })).toBe(undefined);
  });
});

describe('blueprints', () => {
  it('plans every module, and stays until crossed off: rolls are not tracked', () => {
    const todo = fsd({ from: 4, count: 3, targetRolls: 2 });
    expect(reservedMaterials([todo], RANK5)).toMatchObject({ arsenic: 6 });
    expect(todoDone(todo, RANK5)).toBe(false);
  });
});

describe('tradeRate', () => {
  const info = materialInfo;
  it('trades up six for one and down one for three within a family', () => {
    // Carbon (G1) → Vanadium (G2) → Niobium (G3), raw category 1.
    expect(tradeRate(info('carbon'), info('vanadium'))).toEqual({ give: 6, receive: 1 });
    expect(tradeRate(info('carbon'), info('niobium'))).toEqual({ give: 36, receive: 1 });
    expect(tradeRate(info('niobium'), info('carbon'))).toEqual({ give: 1, receive: 9 });
  });

  it('trades across families at six for one, then by grade', () => {
    // Iron is raw category 4 grade 1; Phosphorus category 2 grade 1; Zinc category 4 grade 2.
    expect(tradeRate(info('iron'), info('phosphorus'))).toEqual({ give: 6, receive: 1 });
    expect(tradeRate(info('iron'), info('vanadium'))).toEqual({ give: 36, receive: 1 });
    expect(tradeRate(info('zinc'), info('carbon'))).toEqual({ give: 2, receive: 1 });
  });

  it('refuses across categories and Guardian or Thargoid materials', () => {
    expect(tradeRate(info('iron'), info('chemicalprocessors'))).toBe(undefined);
    expect(
      tradeRate(info('guardian_sentinel_wreckagecomponents'), info('chemicalprocessors')),
    ).toBe(undefined);
  });
});

describe('tradeOptions', () => {
  it('only spends what the to-dos leave spare, covering options first', () => {
    const options = tradeOptions(
      'vanadium',
      2,
      { carbon: 20, iron: 100, niobium: 1 },
      { carbon: 10 },
    );
    // Carbon has 10 spare: one trade of six gives one, not the two wanted. The niobium covers it
    // too, but spends all there is of it.
    expect(
      options.map((option) => [option.from, option.give, option.receive, option.covers]),
    ).toEqual([
      ['iron', 72, 2, true],
      ['niobium', 1, 3, true],
      ['carbon', 6, 1, false],
    ]);
  });
});

describe('materialNeeds', () => {
  it('lists what is short, in the game order', () => {
    const needs = materialNeeds(
      [{ id: 's', kind: 'synthesis', synthesis: 'Limpets', counts: [1, 0, 0] }],
      { iron: 4, nickel: 50 },
      RANK5,
    );
    expect(needs.map((need) => [need.name, need.short])).toEqual([
      ['iron', 6],
      ['nickel', 0],
    ]);
  });
});

describe('engineers', () => {
  it('prefers one who will already craft the grade', () => {
    const offering = ['Elvira Martuuk', 'Felicity Farseer', 'Mel Brandon'];
    expect(
      suitableEngineer(
        offering,
        [
          { name: 'Elvira Martuuk', progress: 'Unlocked', rank: 3 },
          { name: 'Felicity Farseer', progress: 'Unlocked', rank: 5 },
        ],
        5,
      ),
    ).toEqual({ name: 'Felicity Farseer', ready: true });
    expect(suitableEngineer(offering, [], 5)).toEqual({ name: 'Elvira Martuuk', ready: false });
  });

  it('offers the nearest of those who will craft it first, with where they are', () => {
    const options = engineerOptions(
      ['Elvira Martuuk', 'Felicity Farseer', 'Mel Brandon'],
      [
        { name: 'Elvira Martuuk', progress: 'Unlocked', rank: 5 },
        { name: 'Felicity Farseer', progress: 'Unlocked', rank: 5 },
        { name: 'Mel Brandon', progress: 'Invited' },
      ],
      5,
      // Deciat, Felicity Farseer's system.
      { x: 122.625, y: -0.8125, z: -47.28125 },
    );
    expect(options.map((option) => [option.name, option.ready])).toEqual([
      ['Felicity Farseer', true],
      ['Elvira Martuuk', true],
      ['Mel Brandon', false],
    ]);
    expect(options[0]).toMatchObject({
      distanceLy: 0,
      info: { system: 'Deciat', base: 'Farseer Inc' },
    });
    expect(engineerInfo('Tod McQuinn')?.system).toBe('Wolf 397');
  });

  it('prefers one who also does other blueprints on the list, so one visit does both', () => {
    const sensors: BlueprintTodo = {
      id: 'sensors',
      kind: 'blueprint',
      blueprint: 'engineering:sensor_lightweight:sensors',
      from: 0,
      to: 5,
    };
    const shields: BlueprintTodo = {
      id: 'shields',
      kind: 'blueprint',
      blueprint: 'engineering:shieldgenerator_reinforced:shield-generator',
      from: 0,
      to: 5,
    };
    // From Diaguandri, Bill Turner is the nearest for sensors; Lei Cheung does shields too.
    const here = { x: -41.0625, y: -62.15625, z: -103.25 };
    expect(todoEngineerOptions(sensors, RANK5, here)[0]?.name).toBe('Bill Turner');
    expect(todoEngineerOptions(sensors, RANK5, here, [sensors, shields])[0]?.name).toBe(
      'Lei Cheung',
    );
    // The rolls are planned from that engineer's rank, even one not yet ready for the grade.
    const standings: EngineerStanding[] = [
      { name: 'Bill Turner', progress: 'Unlocked', rank: 5 },
      { name: 'Lei Cheung', progress: 'Unlocked', rank: 3 },
    ];
    expect(todoEngineerRank(sensors, standings)).toBe(5);
    expect(todoEngineerRank(sensors, standings, [sensors, shields])).toBe(3);
    // But not one still to unlock, while another who does it is unlocked.
    const invited: EngineerStanding[] = [
      { name: 'Bill Turner', progress: 'Unlocked', rank: 5 },
      { name: 'Lei Cheung', progress: 'Invited' },
    ];
    expect(todoEngineerOptions(sensors, invited, here, [sensors, shields])[0]?.name).toBe(
      'Bill Turner',
    );
  });

  it('matches names without nicknames', () => {
    expect(engineerKey("Tod 'The Blaster' McQuinn")).toBe(engineerKey('Tod McQuinn'));
  });
});

it('labels families the way the game does', () => {
  expect(familyLabel('Category3')).toBe('Raw 3');
  expect(familyLabel('EmissionData')).toBe('Emission data');
  expect(familyLabel('Thargoid1')).toBe('Thargoid 1');
  expect(synthesisByName('Limpets')?.grades[1]?.id).toBe('synthesis:limpets:1');
});

it("files the mine launcher's blueprints under it, not life support as EDDiscovery does", () => {
  expect(blueprintsFor('Life Support').map((blueprint) => blueprint.name)).toEqual([
    'Lightweight',
    'Reinforced',
    'Shielded',
  ]);
  expect(blueprintsFor('Mine Launcher').map((blueprint) => blueprint.name)).toEqual([
    'High Capacity Magazine',
    'Light Weight Mount',
    'Rapid Fire Modification',
    'Sturdy Mount',
  ]);
});

function palin(rank: number): EngineerStanding[] {
  return [{ name: 'Professor Palin', progress: 'Unlocked', rank }];
}

describe('plannedRolls', () => {
  const PALIN = 'engineering:engine_dirty:thrusters';
  const dirty = (patch: Partial<BlueprintTodo> = {}): BlueprintTodo => ({
    id: 'd',
    kind: 'blueprint',
    blueprint: PALIN,
    from: 0,
    to: 5,
    engineer: 'Professor Palin',
    ...patch,
  });

  it('maxes a grade in as many rolls as the journal shows', () => {
    // Palin at rank 5: G1 in one roll, G2 in two… G5 in five.
    expect([1, 2, 3, 4, 5].map((grade) => rollsToMax(grade, 5))).toEqual([1, 2, 3, 4, 5]);
    // At a rank equal to the grade, a fifth a roll, ranking up after three: five either way.
    expect([1, 2, 3, 4, 5].map((grade) => rollsToMax(grade, grade))).toEqual([5, 5, 5, 5, 5]);
    expect(rollsToMax(3, 4)).toBe(4);
  });

  it('maxes every grade, as Inara plans it: five while ranking up, the grade once ranked', () => {
    expect(plannedRolls(dirty(), palin(1))).toEqual([5, 5, 5, 5, 5]);
    // Not yet unlocked counts as the rank 1 it will start at.
    expect(plannedRolls(dirty(), [])).toEqual([5, 5, 5, 5, 5]);
    expect(plannedRolls(dirty(), palin(5))).toEqual([1, 2, 3, 4, 5]);
    // Part-way: G1 and G2 at rank 3 fill faster (a quarter a roll one rank above, as Palin's G1
    // did at rank 2), then G3 and G4 rank up.
    expect(plannedRolls(dirty(), palin(3))).toEqual([3, 4, 5, 5, 5]);
  });

  it('pays for the rank-ups once, however many modules', () => {
    expect(plannedRolls(dirty({ count: 2 }), palin(1))).toEqual([6, 7, 8, 9, 10]);
  });

  it('takes the rolls asked for at the target, and nothing for an experimental alone', () => {
    expect(plannedRolls(dirty({ targetRolls: 1 }), palin(5))).toEqual([1, 2, 3, 4, 1]);
    expect(plannedRolls(dirty({ from: 4, onlyExperimental: true }), palin(5))).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });
});

it("drops the rolls saved before they were planned from the engineer's rank", () => {
  const old = { kind: 'blueprint', blueprint: FSD, from: 0, to: 5, rolls: 1 };
  expect(sanitizeTodo(old)).toEqual({ kind: 'blueprint', blueprint: FSD, from: 0, to: 5 });
  expect(sanitizeTodo({ ...old, targetRolls: 2 })).toMatchObject({ targetRolls: 2 });
});

it('offers each experimental once, and none on life support', () => {
  const railgun = experimentalChoices('Rail Gun');
  expect(railgun.filter((recipe) => recipe.name === 'Feedback Cascade')).toHaveLength(1);
  expect(railgun.find((recipe) => recipe.name === 'Super Penetrator')?.fdName).toBe(
    'special_super_penetrator_cooled',
  );
  expect(experimentalsFor('Life Support')).toEqual([]);
  expect(experimentalChoices('Mine Launcher').map((recipe) => recipe.name)).toContain(
    'Radiant Canister',
  );
});

describe('planTrades', () => {
  const need = (name: string, have: number, needed: number) => ({
    name,
    info: materialInfo(name),
    have,
    need: needed,
    short: Math.max(0, needed - have),
  });

  it('spends each spare material once, the shortfall with fewer ways first', () => {
    // Zinc (raw 4, G2) can only come from iron (raw 4, G1, six for one). Vanadium (raw 1, G2) can
    // come from iron too (36 for one), or from carbon (raw 1, G1, six for one). Iron can't pay for
    // both, so zinc takes it and vanadium the carbon.
    const plan = planTrades(
      [need('vanadium', 0, 2), need('zinc', 0, 5)],
      { iron: 100, carbon: 20 },
      { vanadium: 2, zinc: 5 },
    );
    expect(plan.trades).toEqual([
      { from: 'carbon', give: 12, to: 'vanadium', receive: 2 },
      { from: 'iron', give: 30, to: 'zinc', receive: 5 },
    ]);
    expect(plan.unmet).toEqual([]);
  });

  it('combines sources, and says what is left short', () => {
    // 12 spare carbon buys 2 vanadium; 40 iron buys one more at 36 for one; nothing buys the rest.
    const plan = planTrades([need('vanadium', 0, 5)], { carbon: 12, iron: 40 }, { vanadium: 5 });
    expect(plan.trades.map((trade) => [trade.from, trade.receive])).toEqual([
      ['carbon', 2],
      ['iron', 1],
    ]);
    expect(plan.unmet).toEqual([{ name: 'vanadium', short: 2 }]);
  });

  it('leaves out what traders will not take', () => {
    const plan = planTrades(
      [need('guardian_powercell', 0, 3)],
      { guardian_sentinel_wreckagecomponents: 100 },
      {},
    );
    expect(plan).toEqual({ trades: [], unmet: [] });
  });
});

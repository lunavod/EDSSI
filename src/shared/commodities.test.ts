import { describe, expect, it } from 'vitest';

import {
  journalCommodityName,
  type MarketStation,
  mergeShopping,
  missingNeeds,
  parseShoppingCsv,
  planProgress,
  planPurchases,
  planSales,
  recordPlanPurchase,
  recordPurchase,
  sellableHold,
  type ShoppingItem,
} from './commodities';

const item = (commodity: string, needed: number, bought = 0, id = commodity): ShoppingItem => ({
  id,
  commodity,
  needed,
  bought,
});

const lines = (items: ShoppingItem[]) =>
  items.map(({ commodity, needed, bought }) => ({ commodity, needed, bought }));

describe('sellableHold', () => {
  it('merges each commodity, leaving out mission and stolen cargo, most first', () => {
    expect(
      sellableHold([
        { Name: 'gold', Count: 10, Stolen: 0 },
        { Name: 'steel', Name_Localised: 'Stahl', Count: 50, Stolen: 20 },
        { Name: 'gold', Count: 5, Stolen: 0, MissionID: 123 },
        { Name: '$gold_name;', Count: 25, Stolen: 0 },
        { Name: 'biowaste', Count: 3, Stolen: 3 },
      ]),
    ).toEqual([
      { commodity: 'Gold', count: 35 },
      { commodity: 'Steel', count: 30 },
    ]);
  });
});

describe('parseShoppingCsv', () => {
  it('reads commodity and quantity, skipping a heading row', () => {
    expect(parseShoppingCsv('Commodity,Quantity\nSteel,500\r\nCMM Composite,"1,200"\n\n')).toEqual([
      { commodity: 'Steel', quantity: 500 },
      { commodity: 'CMM Composite', quantity: 1200 },
    ]);
  });

  it('takes semicolons or tabs, and adds up a commodity listed twice', () => {
    expect(parseShoppingCsv('Steel;10\nsteel;5\nWater;3 t')).toEqual([
      { commodity: 'Steel', quantity: 15 },
      { commodity: 'Water', quantity: 3 },
    ]);
    expect(parseShoppingCsv('Steel\t10')).toEqual([{ commodity: 'Steel', quantity: 10 }]);
  });

  it('says which line is wrong', () => {
    expect(() => parseShoppingCsv('Steel,10\nWater,lots')).toThrow(/Line 2/);
    expect(() => parseShoppingCsv('Commodity,Quantity')).toThrow(/no rows/);
  });
});

describe('the shopping list', () => {
  let count = 0;
  const newId = () => `id${++count}`;

  it('replaces the list with an import, or adds to it', () => {
    const items = [item('Steel', 100, 40), item('Water', 5)];
    const imported = [
      { commodity: 'steel', quantity: 50 },
      { commodity: 'Titanium', quantity: 7 },
    ];
    expect(lines(mergeShopping(items, imported, 'replace', newId))).toEqual([
      { commodity: 'steel', needed: 50, bought: 0 },
      { commodity: 'Titanium', needed: 7, bought: 0 },
    ]);
    const added = mergeShopping(items, imported, 'add', newId);
    expect(lines(added)).toEqual([
      { commodity: 'Steel', needed: 150, bought: 40 },
      { commodity: 'Water', needed: 5, bought: 0 },
      { commodity: 'Titanium', needed: 7, bought: 0 },
    ]);
    expect(items[0]!.needed).toBe(100);
  });

  it('lists what is still missing, once per commodity', () => {
    expect(
      missingNeeds([
        item('Steel', 100, 40),
        item('Water', 5, 9),
        item('steel', 10, 0, 'b'),
        item(' ', 3),
      ]),
    ).toEqual([{ commodity: 'Steel', quantity: 70 }]);
  });

  it('counts a purchase against the first line still short of it', () => {
    const items = [item('Liquid oxygen', 10, 10, 'a'), item('Liquid Oxygen', 10, 0, 'b')];
    const next = recordPurchase(items, [journalCommodityName('liquidoxygen')], 4);
    expect(next?.map((line) => line.bought)).toEqual([10, 4]);
    expect(recordPurchase(items, ['Gold'], 4)).toBeUndefined();
  });

  it('names a journal commodity in English, or as the journal localised it', () => {
    expect(journalCommodityName('CMMComposite', 'CMM-Verbundstoff')).toBe('CMM Composite');
    expect(journalCommodityName('madeup', 'Made Up')).toBe('Made Up');
  });
});

function station(
  name: string,
  distanceLy: number,
  offers: [commodity: string, price: number, supply: number][],
  coords?: [number, number, number],
): MarketStation {
  return {
    marketId: name,
    name,
    type: 'Coriolis Starport',
    system: `${name} system`,
    distanceLy,
    planetary: false,
    carrier: false,
    ...(coords && { coords }),
    offers: offers.map(([commodity, buyPrice, supply]) => ({ commodity, buyPrice, supply })),
  };
}

describe('planSales', () => {
  const buyer = (name: string, distance: number, bids: [string, number, number][]) => {
    const { offers: _none, ...place } = station(name, distance, []);
    return {
      ...place,
      bids: bids.map(([commodity, sellPrice, demand]) => ({ commodity, sellPrice, demand })),
    };
  };

  it('sells across markets when no one wants it all, and where it pays most', () => {
    const near = buyer('Near', 5, [
      ['Gold', 50_000, 100],
      ['Silver', 4000, 500],
    ]);
    const far = buyer('Far', 30, [['Gold', 60_000, 200]]);
    const plans = planSales(
      [
        { commodity: 'Gold', quantity: 250 },
        { commodity: 'Silver', quantity: 50 },
        { commodity: 'Tea', quantity: 5 },
      ],
      [near, far],
    );
    const best = plans.find((plan) => plan.kind === 'cheapest' || plan.cheapest)!;
    expect(best.cost).toBe(200 * 60_000 + 50 * 50_000 + 50 * 4000);
    expect(best.stops.map((stop) => [stop.station.name, stop.tonnes])).toEqual([
      ['Near', 100],
      ['Far', 200],
    ]);
    expect(best.short).toEqual([{ commodity: 'Tea', quantity: 5 }]);
    expect(plans.every((plan) => plan.tonnes === 300)).toBe(true);
  });
});

describe('planPurchases', () => {
  const needs = [
    { commodity: 'Steel', quantity: 100 },
    { commodity: 'Water', quantity: 50 },
  ];

  it('buys everything at one market when one stocks it all, and offers the cheapest too', () => {
    const big = station('Big', 20, [
      ['Steel', 5000, 1000],
      ['Water', 300, 1000],
    ]);
    const cheapSteel = station('Cheap', 10, [['Steel', 4000, 1000]]);
    const plans = planPurchases(needs, [cheapSteel, big]);
    expect(plans[0]).toMatchObject({
      kind: 'fewest-stops',
      stops: [{ station: { name: 'Big' }, tonnes: 150 }],
      cost: 100 * 5000 + 50 * 300,
      short: [],
    });
    const cheapest = plans.find((plan) => plan.kind === 'cheapest' || plan.cheapest)!;
    expect(cheapest.cost).toBe(100 * 4000 + 50 * 300);
    expect(cheapest.stops.map((stop) => stop.station.name)).toEqual(['Cheap', 'Big']);
  });

  it('splits across markets when stock runs short, and says what none has', () => {
    const plans = planPurchases(
      [...needs, { commodity: 'Gold', quantity: 1 }],
      [
        station('A', 5, [['Steel', 10, 60]]),
        station('B', 8, [
          ['Steel', 10, 60],
          ['Water', 1, 50],
        ]),
      ],
    );
    const best = plans[0]!;
    expect(best.stops.map((stop) => [stop.station.name, stop.tonnes])).toEqual([
      ['A', 40],
      ['B', 110],
    ]);
    expect(best.short).toEqual([{ commodity: 'Gold', quantity: 1 }]);
  });

  it('flies the stops nearest first, then nearest to the last', () => {
    const plans = planPurchases(
      [{ commodity: 'Steel', quantity: 30 }],
      [
        station('Far', 50, [['Steel', 1, 10]], [50, 0, 0]),
        station('Near', 10, [['Steel', 1, 10]], [-10, 0, 0]),
        station('Mid', 30, [['Steel', 1, 10]], [-30, 0, 0]),
      ],
    );
    const cheapest = plans.find((plan) => plan.kind === 'cheapest' || plan.cheapest)!;
    expect(cheapest.stops.map((stop) => stop.station.name)).toEqual(['Near', 'Mid', 'Far']);
    expect(cheapest.travelLy).toBe(10 + 20 + 80);
  });

  it('minimising planetary markets, buys on planets only what no orbital market has', () => {
    const port = {
      ...station('Port', 5, [
        ['Steel', 10, 1000],
        ['Water', 1, 1000],
      ]),
      planetary: true,
    };
    const orbital = station('Orbital', 40, [['Steel', 20, 1000]]);
    const needs = [
      { commodity: 'Steel', quantity: 100 },
      { commodity: 'Water', quantity: 50 },
    ];
    // Left to itself, the port has it all, nearer and cheaper.
    expect(
      planPurchases(needs, [port, orbital])[0]?.stops.map((stop) => stop.station.name),
    ).toEqual(['Port']);
    const plans = planPurchases(needs, [port, orbital], { minimisePlanetary: true });
    for (const plan of plans) {
      expect(plan.short).toEqual([]);
      expect(
        plan.stops.map((stop) => [stop.station.name, stop.purchases.map((buy) => buy.commodity)]),
      ).toEqual([
        ['Port', ['Water']],
        ['Orbital', ['Steel']],
      ]);
    }
  });

  it('plans nothing for nothing missing', () => {
    expect(planPurchases([], [station('A', 1, [['Steel', 1, 1]])])).toEqual([]);
  });
});

describe('a pinned plan', () => {
  const plan = planPurchases(
    [
      { commodity: 'Steel', quantity: 100 },
      { commodity: 'Water', quantity: 50 },
    ],
    [
      station('A', 5, [['Steel', 10, 60]]),
      station('B', 8, [
        ['Steel', 10, 60],
        ['Water', 2, 50],
      ]),
    ],
  )[0]!;
  const bought = (next: typeof plan) =>
    next.stops.map((stop) => [
      stop.station.name,
      stop.purchases.map((purchase) => [purchase.commodity, purchase.bought ?? 0]),
    ]);

  it('counts a purchase at the stop it was made, then at the others', () => {
    // A buys 40 Steel, B 60 Steel and the Water.
    const atB = recordPlanPurchase(plan, 'B', ['Steel'], 70)!;
    expect(bought(atB)).toEqual([
      ['A', [['Steel', 10]]],
      [
        'B',
        [
          ['Steel', 60],
          ['Water', 0],
        ],
      ],
    ]);
    expect(planProgress(atB)).toEqual({ bought: 70, left: 80, leftCost: 30 * 10 + 50 * 2 });
  });

  it('counts a purchase elsewhere in stop order, and keeps what is bought past the plan', () => {
    const elsewhere = recordPlanPurchase(plan, 'Z', ['Steel'], 130)!;
    expect(bought(elsewhere)[0]).toEqual(['A', [['Steel', 70]]]);
    expect(planProgress(elsewhere)).toEqual({ bought: 100, left: 50, leftCost: 100 });
    expect(recordPlanPurchase(plan, 'A', ['Gold'], 1)).toBeUndefined();
    expect(plan.stops[0]!.purchases[0]!.bought).toBeUndefined();
  });
});

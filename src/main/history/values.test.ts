import { describe, expect, it } from 'vitest';

import { type BodyValueInput, estimateBodyValue, isTerraformable, organicValue } from './values';

const unmapped = { mapped: false, mappedEfficiently: false, odyssey: true } as const;

function planet(fields: Partial<BodyValueInput>): BodyValueInput {
  return { planetClass: 'High metal content body', massEM: 1, ...unmapped, ...fields };
}

/** The 3.3+ planet base value for a class constant `k` and mass in Earth masses. */
const planetBase = (k: number, mass = 1) => Math.max(k + k * Math.pow(mass, 0.2) * 0.56591828, 500);

/** Odyssey's bonus on mapped bodies. */
const ody = (value: number) => value + Math.max(value * 0.3, 555);

describe('estimateBodyValue', () => {
  it('values stars by type and mass, with the first discovery bonus', () => {
    // k + m·k/66.25 with k = 1200 for main sequence stars.
    const sun = { starType: 'G', stellarMass: 1, wasDiscovered: true, ...unmapped };
    expect(estimateBodyValue(sun)).toBe(Math.trunc(1200 + 1200 / 66.25));
    expect(estimateBodyValue({ ...sun, wasDiscovered: false })).toBe(
      Math.trunc((1200 + 1200 / 66.25) * 2.6),
    );
    expect(estimateBodyValue({ ...sun, starType: 'DA' })).toBe(Math.trunc(14057 + 14057 / 66.25));
    expect(estimateBodyValue({ ...sun, starType: 'N' })).toBe(Math.trunc(22628 + 22628 / 66.25));
  });

  it('gives belt clusters no value', () => {
    expect(estimateBodyValue({ ...unmapped })).toBe(0);
  });

  it('values planets by class, mass and terraformability', () => {
    expect(estimateBodyValue(planet({ wasDiscovered: true }))).toBe(Math.trunc(planetBase(9654)));
    expect(
      estimateBodyValue(planet({ wasDiscovered: true, terraformState: 'Terraformable' })),
    ).toBe(Math.trunc(planetBase(9654 + 100677)));
    expect(
      estimateBodyValue(
        planet({ planetClass: 'Earthlike body', massEM: 0.5, wasDiscovered: true }),
      ),
    ).toBe(Math.trunc(planetBase(64831 + 116295, 0.5)));
    // Anything unlisted (icy, rocky…) has k = 300, and no body is worth less than 500.
    expect(estimateBodyValue(planet({ planetClass: 'Icy body', massEM: 0.001 }))).toBe(500);
  });

  it('pays for mapping, first mapping and efficiency like the game', () => {
    const k = 9654;
    const base = k + k * 0.56591828;
    const firstEver = planet({ wasDiscovered: false, wasMapped: false });

    expect(estimateBodyValue(firstEver)).toBe(Math.trunc(base * 2.6));
    expect(estimateBodyValue({ ...firstEver, mapped: true })).toBe(
      Math.trunc(ody(base * 3.699622554) * 2.6),
    );
    // The efficiency bonus applies to first discovered and mapped bodies too.
    expect(estimateBodyValue({ ...firstEver, mapped: true, mappedEfficiently: true })).toBe(
      Math.trunc(ody(base * 3.699622554) * 2.6 * 1.25),
    );
    expect(estimateBodyValue(planet({ wasDiscovered: true, wasMapped: false, mapped: true }))).toBe(
      Math.trunc(ody(base * 8.0956)),
    );
    expect(estimateBodyValue(planet({ wasDiscovered: true, wasMapped: true, mapped: true }))).toBe(
      Math.trunc(ody(base * 3.3333333)),
    );
    // Undiscovered but already mapped: mapping it again is all that pays extra.
    expect(estimateBodyValue(planet({ wasDiscovered: false, wasMapped: true }))).toBe(
      Math.trunc(base),
    );
  });

  it('leaves out the Odyssey mapping bonus in Horizons', () => {
    const k = 9654;
    const base = k + k * 0.56591828;
    expect(
      estimateBodyValue(
        planet({ wasDiscovered: true, wasMapped: true, mapped: true, odyssey: false }),
      ),
    ).toBe(Math.trunc(base * 3.3333333));
  });
});

describe('isTerraformable', () => {
  it.each([
    ['Terraformable', true],
    ['Terraforming', true],
    ['Terraformed', true],
    ['', false],
    [undefined, false],
  ])('%s → %s', (state, expected) => {
    expect(isTerraformable(state)).toBe(expected);
  });
});

describe('organicValue', () => {
  it('looks species up by their codex name', () => {
    expect(organicValue('$Codex_Ent_Bacterial_04_Name;')).toBe(1000000);
    expect(organicValue('$Codex_Ent_Fonticulus_05_Name;')).toBe(20000000);
    expect(organicValue('$Codex_Ent_Thargoid_Coral_Tree_Name;')).toBe(1896800);
    expect(organicValue('$Codex_Ent_Unheard_Of_Name;')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import {
  galacticRegion,
  isStarClass,
  type PlanetFacts,
  predictLife,
  type SystemFacts,
} from './predict';

// Blu Theia WF-S c19-0, from a real journal: a K star, and a thin-CO2 high metal content planet on
// which the commander found Bacterium Aurasus (Green) and Stratum Tectonicas (Lime).
const bluTheia: SystemFacts = {
  name: 'Blu Theia WF-S c19-0',
  position: [8580.75, 655.625, 2337.96875],
  stars: [{ bodyName: 'Blu Theia WF-S c19-0', starType: 'K', luminosity: 'Vab', distanceLs: 0 }],
  planetClasses: ['High metal content body'],
};
const planetTwo: PlanetFacts = {
  bodyName: 'Blu Theia WF-S c19-0 2',
  planetClass: 'High metal content body',
  atmosphereType: 'CarbonDioxide',
  atmosphere: { CarbonDioxide: 93.466454, SulphurDioxide: 6.53355 },
  volcanism: '',
  gravity: 4.001408,
  temperature: 195.829926,
  pressure: 3498.753662,
  distanceLs: 748,
  materials: ['iron', 'nickel', 'sulphur', 'carbon', 'tellurium'],
};

const names = (system: SystemFacts, planet: PlanetFacts) =>
  predictLife(system, planet).map((genus) => [
    genus.name,
    genus.species.map((species) => `${species.name} ${species.colours.join('/')}`.trim()),
  ]);

describe('predictLife', () => {
  it('predicts the species a real planet had, colour and all', () => {
    expect(names(bluTheia, planetTwo)).toEqual([
      ['Bacterium', ['Bacterium Aurasus Green']],
      ['Stratum', ['Stratum Tectonicas Lime']],
    ]);
  });

  it('prices species cheapest first, from the Vista Genomics table', () => {
    const [bacterium] = predictLife(bluTheia, planetTwo);
    expect(bacterium?.species[0]?.value).toBe(1_000_000);
    expect(bacterium?.colonyDistance).toBe(500);
  });

  it('finds nothing on an airless body without volcanism', () => {
    expect(predictLife(bluTheia, { ...planetTwo, atmosphereType: 'None', pressure: 0 })).toEqual(
      [],
    );
  });

  it('rules out a star-coloured species when the star has no colour for it', () => {
    const neutronStar: SystemFacts = {
      ...bluTheia,
      stars: [{ bodyName: bluTheia.name, starType: 'H', distanceLs: 0 }],
    };
    // Stratum Tectonicas comes in no colour for a black hole; Bacterium Aurasus does.
    expect(names(neutronStar, planetTwo).map(([genus]) => genus)).not.toContain('Stratum');
  });

  it('reads a planet in a multiple system as orbiting the stars in its name', () => {
    const binary: SystemFacts = {
      ...bluTheia,
      stars: [
        { bodyName: `${bluTheia.name} A`, starType: 'K', distanceLs: 0 },
        { bodyName: `${bluTheia.name} B`, starType: 'M', distanceLs: 9000 },
      ],
    };
    const [bacterium] = predictLife(binary, { ...planetTwo, bodyName: `${bluTheia.name} B 2` });
    // Colour from the parent (M: Teal) and the arrival star (K: Green).
    expect(bacterium?.species[0]?.colours).toEqual(['Green', 'Teal']);
  });

  it('never rules a species out on a position the journal has not given', () => {
    const nowhere = { ...bluTheia, position: undefined };
    expect(names(nowhere, planetTwo)).toEqual(names(bluTheia, planetTwo));
  });

  it('keeps species with material colours to bodies holding one of those materials', () => {
    // Bacterium Nebulus needs helium on a very cold icy body, and a rare element for its colour.
    const icy: PlanetFacts = {
      bodyName: `${bluTheia.name} 9`,
      planetClass: 'Icy body',
      atmosphereType: 'Helium',
      volcanism: '',
      gravity: 0.5 * 9.797759,
      temperature: 20.5,
      pressure: 0.1 * 101_231.65625,
      materials: ['iron', 'polonium'],
    };
    const nebulus = () =>
      predictLife(bluTheia, icy)
        .flatMap((genus) => genus.species)
        .find((species) => species.name === 'Bacterium Nebulus');
    expect(nebulus()?.colours).toEqual(['Gold']);
    icy.materials = ['iron'];
    expect(nebulus()).toBeUndefined();
  });
});

describe('galacticRegion', () => {
  it('places Sol in the Inner Orion Spur and Sagittarius A* in the Galactic Centre', () => {
    expect(galacticRegion([0, 0, 0])).toBe(18);
    expect(galacticRegion([25.21875, -20.90625, 25899.96875])).toBe(1);
    expect(galacticRegion([-100_000, 0, 0])).toBeUndefined();
  });
});

describe('isStarClass', () => {
  it('counts giants as their class and any white dwarf as D', () => {
    expect(isStarClass('M', 'M_RedSuperGiant')).toBe(true);
    expect(isStarClass('D', 'DAB')).toBe(true);
    expect(isStarClass('A', 'AeBe')).toBe(false);
  });
});

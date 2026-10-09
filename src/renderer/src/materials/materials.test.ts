import { describe, expect, it } from 'vitest';

import { RECIPES, recipeById } from '../../../shared/materials';
import { formatIngredients, groupRecipes, matchesQuery, recipeLine, recipeName } from './materials';

describe('recipeLine', () => {
  it('sets what the commander has against what the recipe takes', () => {
    const line = recipeLine(
      recipeById('synthesis:limpets:1')!,
      { iron: 25, nickel: 9 },
      new Set(['synthesis:limpets:1']),
    );
    expect(line.favourite).toBe(true);
    expect(line.times).toBe(0);
    expect(line.ingredients).toEqual([
      { name: 'iron', label: 'Iron', need: 10, have: 25 },
      { name: 'nickel', label: 'Nickel', need: 10, have: 9 },
    ]);
  });
});

describe('recipeName', () => {
  it('adds the module for a blueprint outside its group', () => {
    const blueprint = RECIPES.find((recipe) =>
      recipe.id.startsWith('engineering:weapon_longrange:beam-laser:5'),
    )!;
    expect(recipeName(blueprint)).toBe('Long-Range Weapon · Beam Laser');
    expect(recipeName(recipeById('synthesis:afm-refill:2')!)).toBe('AFM Refill');
  });
});

describe('formatIngredients', () => {
  it('names each material with its count after it', () => {
    expect(
      formatIngredients([
        ['iron', 10],
        ['nickel', 2],
      ]),
    ).toBe('Iron 10 · Nickel 2');
  });
});

describe('matchesQuery', () => {
  it('needs every word, from the name, group or ingredients', () => {
    const limpets = recipeById('synthesis:limpets:1')!;
    expect(matchesQuery(limpets, '')).toBe(true);
    expect(matchesQuery(limpets, 'limp nickel')).toBe(true);
    expect(matchesQuery(limpets, 'limp zinc')).toBe(false);
  });
});

describe('groupRecipes', () => {
  it('groups by kind and group, counting what can be made', () => {
    const lines = ['synthesis:afm-refill:1', 'synthesis:afm-refill:2', 'synthesis:limpets:1'].map(
      (id) => recipeLine(recipeById(id)!, { iron: 10, nickel: 10 }, new Set()),
    );
    expect(
      groupRecipes(lines).map((group) => [group.name, group.lines.length, group.craftable]),
    ).toEqual([
      ['AFM Refill', 2, 0],
      ['Limpets', 1, 1],
    ]);
  });
});

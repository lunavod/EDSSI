import { describe, expect, it } from 'vitest';

import {
  craftableTimes,
  DEFAULT_FAVOURITE_RECIPES,
  favouriteIds,
  gradeLabel,
  MATERIALS,
  matchRecipe,
  RECIPES,
  recipeById,
} from './materials';

describe('recipes', () => {
  it('has the default favourites, with what the game asks for them', () => {
    const favourites = DEFAULT_FAVOURITE_RECIPES.map((id) => recipeById(id));
    expect(favourites.map((recipe) => recipe && `${recipe.name} ${recipe.grade}`)).toEqual([
      'AFM Refill 1',
      'AFM Refill 2',
      'AFM Refill 3',
      'Life Support 1',
      'Limpets 1',
    ]);
    expect(recipeById('synthesis:limpets:1')?.ingredients).toEqual([
      ['iron', 10],
      ['nickel', 10],
    ]);
  });

  it('names every ingredient', () => {
    const unnamed = RECIPES.flatMap((recipe) => recipe.ingredients).filter(
      ([name]) => MATERIALS[name] === undefined,
    );
    expect(unnamed).toEqual([]);
  });

  it('has an id for each recipe of its own', () => {
    expect(new Set(RECIPES.map((recipe) => recipe.id)).size).toBe(RECIPES.length);
  });
});

describe('craftableTimes', () => {
  it('is limited by the scarcest ingredient', () => {
    const limpets = recipeById('synthesis:limpets:1')!;
    expect(craftableTimes(limpets, { iron: 35, nickel: 22 })).toBe(2);
    expect(craftableTimes(limpets, { iron: 35 })).toBe(0);
  });
});

describe('matchRecipe', () => {
  it('tells synthesis recipes sharing a journal name apart by their ingredients', () => {
    expect(
      matchRecipe('synthesis', 'Ammo Basic', [
        ['phosphorus', 1],
        ['sulphur', 2],
      ])?.id,
    ).toBe('synthesis:srv-ammo:1');
  });

  it('matches a real Synthesis line', () => {
    const recipe = matchRecipe('synthesis', 'Module Repair Basic', [
      ['nickel', 2],
      ['zinc', 2],
      ['chromium', 2],
      ['vanadium', 3],
    ]);
    expect(recipe?.id).toBe('synthesis:afm-refill:1');
  });

  it('matches an experimental effect by its journal name', () => {
    const recipe = matchRecipe('experimental', 'special_shield_health', [
      ['wornshieldemitters', 5],
      ['uncutfocuscrystals', 3],
      ['conductivepolymers', 1],
    ]);
    expect(recipe?.name).toBe('Hi-Cap');
  });

  it('finds nothing when neither name nor ingredients fit', () => {
    expect(matchRecipe('synthesis', 'Nonsense', [['iron', 99]])).toBeUndefined();
  });
});

describe('favouriteIds', () => {
  it('starts from the defaults and follows the commander', () => {
    const ids = favouriteIds(
      new Map([
        ['synthesis:limpets:1', false],
        ['synthesis:fsd:3', true],
      ]),
    );
    expect(ids).not.toContain('synthesis:limpets:1');
    expect(ids).toContain('synthesis:afm-refill:1');
    expect(ids).toContain('synthesis:fsd:3');
  });
});

describe('gradeLabel', () => {
  it('names synthesis grades and numbers the rest', () => {
    expect(gradeLabel('synthesis', 3)).toBe('Premium');
    expect(gradeLabel('engineering', 5)).toBe('G5');
    expect(gradeLabel('techbroker', undefined)).toBeUndefined();
  });
});

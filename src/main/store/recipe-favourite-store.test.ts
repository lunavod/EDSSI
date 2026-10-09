import { describe, expect, it } from 'vitest';

import { openDatabase } from './database';
import { RecipeFavouriteStore } from './recipe-favourite-store';

describe('RecipeFavouriteStore', () => {
  it('keeps the latest choice per recipe', () => {
    const db = openDatabase(':memory:');
    const store = new RecipeFavouriteStore(db);
    expect(store.choices()).toEqual(new Map());

    store.set('synthesis:limpets:1', false);
    store.set('synthesis:fsd:3', false);
    store.set('synthesis:fsd:3', true);

    expect(store.choices()).toEqual(
      new Map([
        ['synthesis:limpets:1', false],
        ['synthesis:fsd:3', true],
      ]),
    );
    db.close();
  });
});

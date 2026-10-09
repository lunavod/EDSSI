/**
 * Turns the assistant's plain filters into the shapes Spansh's search expects. The shape depends
 * on each field's type, which Spansh lists at `/api/<kind>/searchable_fields`; a field it doesn't
 * know is silently ignored by the server, so names are checked here instead.
 */

import type { SearchableField } from './client';

/** One condition, as the model writes it. Which parts matter depends on the field's type. */
export interface FilterCondition {
  field: string;
  /** Any of these, for fields with fixed values (`type`, `services`, `allegiance`, …). */
  values?: string[];
  /** A name to match, for free-text fields (`name`, `system_name`, …). */
  text?: string;
  /** Lower and upper bounds, for numbers and timestamps (ISO dates). */
  min?: number | string;
  max?: number | string;
  /** For yes/no fields. */
  is?: boolean;
}

export interface Filter extends FilterCondition {
  /** For named amounts (`signals`, `materials`, `economies`, …): which one, e.g. `Biological`. */
  name?: string;
  /** For lists of items (`modules`, `ships`, `marketplace`, `stations`, `rings`, …): one item's parts. */
  parts?: FilterCondition[];
}

export interface Sort {
  field: string;
  direction: 'asc' | 'desc';
  /** For sorts that need one item, e.g. `market_sell_price` of `Gold`. */
  name?: string;
}

export class FilterError extends Error {}

/** The subfields of `rings` and `belts`, which the field list only calls `special`. */
const RING_PARTS: Record<string, { type: string }> = {
  type: { type: 'group' },
  inner_radius: { type: 'numeric' },
  outer_radius: { type: 'numeric' },
};

export function buildFilters(
  filters: readonly Filter[],
  fields: readonly SearchableField[],
): Record<string, unknown> {
  const byName = new Map(fields.map((known) => [known.field, known]));
  const built: Record<string, unknown> = {};

  for (const filter of filters) {
    const known = byName.get(filter.field);
    if (!known) throw new FilterError(unknownField(filter.field, fields));

    if (known.type === 'combined' || isRingField(known)) {
      const subfields = known.subfields ?? RING_PARTS;
      if (!filter.parts?.length) {
        throw new FilterError(
          `${filter.field} needs parts, one per condition on the item: ` +
            `${Object.keys(subfields).join(', ')}.`,
        );
      }
      const item: Record<string, unknown> = {};
      for (const part of filter.parts) {
        const sub = subfields[part.field];
        if (!sub) {
          throw new FilterError(
            `${filter.field} has no part called ${part.field}; it has ` +
              `${Object.keys(subfields).join(', ')}.`,
          );
        }
        const label = `${filter.field}.${part.field}`;
        // A ring or belt's type is a bare list, unlike the group parts of other items.
        item[part.field] =
          !known.subfields && sub.type === 'group'
            ? valuesOf(label, part)
            : condition(label, sub.type, part);
      }
      pushTo(built, filter.field, item);
      continue;
    }

    if (known.type === 'value_struct') {
      const nameField = known.subfield?.name ?? 'name';
      const valueField = known.valuefield?.name ?? 'value';
      if (!filter.name) {
        throw new FilterError(`${filter.field} needs a name, e.g. which signal or material.`);
      }
      // A bare name means "has any"; an open bound has to be a one-sided comparison, as Spansh
      // fails the whole search on a huge upper bound.
      const { comparison, value } = range(filter.field, { ...filter, min: filter.min ?? 1 });
      pushTo(built, filter.field, { [nameField]: filter.name, comparison, [valueField]: value });
      continue;
    }

    if (known.type === 'special') {
      throw new FilterError(
        filter.field === 'market'
          ? 'Filter commodities with marketplace: parts commodity, supply, demand, buy_price, sell_price.'
          : `${filter.field} can't be filtered here.`,
      );
    }

    built[filter.field] =
      filter.field === 'distance' ? distance(filter) : condition(filter.field, known.type, filter);
  }
  return built;
}

export function buildSort(sorts: readonly Sort[]): Record<string, unknown>[] {
  return sorts.map((sort) =>
    sort.name === undefined
      ? { [sort.field]: { direction: sort.direction } }
      : { [sort.field]: [{ name: sort.name, direction: sort.direction }] },
  );
}

function condition(label: string, type: string, filter: FilterCondition): unknown {
  switch (type) {
    case 'group':
    case 'keyword': {
      const values = valuesOf(label, filter);
      return { value: type === 'keyword' && values.length === 1 ? values[0] : values };
    }
    case 'string': {
      const text = filter.text ?? filter.values?.[0];
      if (text === undefined) throw new FilterError(`${label} needs text.`);
      return { value: text };
    }
    case 'boolean':
      if (filter.is === undefined) throw new FilterError(`${label} needs is: true or false.`);
      return { value: filter.is };
    case 'numeric':
    case 'timestamp':
      return range(label, filter);
    default:
      throw new FilterError(`${label} (${type}) can't be filtered here.`);
  }
}

function valuesOf(label: string, filter: FilterCondition): string[] {
  const values = filter.values ?? (filter.text === undefined ? undefined : [filter.text]);
  if (!values?.length) throw new FilterError(`${label} needs values.`);
  return values;
}

function range(label: string, filter: FilterCondition): { comparison: string; value: unknown } {
  const { min, max } = filter;
  if (min !== undefined && max !== undefined) return { comparison: '<=>', value: [min, max] };
  if (min !== undefined) return { comparison: '>=', value: min };
  if (max !== undefined) return { comparison: '<=', value: max };
  throw new FilterError(`${label} needs min, max or both.`);
}

/** Distance from the reference is its own shape. */
function distance(filter: FilterCondition): unknown {
  if (filter.min === undefined && filter.max === undefined) {
    throw new FilterError('distance needs min, max or both, in light years.');
  }
  return {
    ...(filter.min === undefined ? {} : { min: filter.min }),
    ...(filter.max === undefined ? {} : { max: filter.max }),
  };
}

function isRingField(known: SearchableField): boolean {
  return known.type === 'special' && (known.subtype === 'ring' || known.subtype === 'belt');
}

function pushTo(built: Record<string, unknown>, key: string, item: unknown): void {
  const list = built[key];
  if (Array.isArray(list)) list.push(item);
  else built[key] = [item];
}

function unknownField(name: string, fields: readonly SearchableField[]): string {
  const words = name.toLowerCase().split(/[_\s]+/);
  const close = fields
    .map((known) => known.field)
    .filter((known) => words.some((word) => word.length > 2 && known.includes(word)));
  return (
    `There is no field called ${name}.` +
    (close.length ? ` Close: ${close.slice(0, 8).join(', ')}.` : '') +
    ' spansh_search_fields lists them all.'
  );
}

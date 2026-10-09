/**
 * Generates src/shared/journal-events.generated.ts from the community-maintained journal schemas at
 * github.com/jixxed/ed-journal-schemas (pinned below). Bump SCHEMA_COMMIT and rerun
 * `npm run gen:journal-types` after a game update.
 */
// oxlint-disable typescript/no-unsafe-type-assertion -- walking untyped schema JSON.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SCHEMA_REPO = 'https://github.com/jixxed/ed-journal-schemas';
const SCHEMA_COMMIT = 'e4976b5f9b46f784029364453622c2668087cfd6';

/** Integer fields that can exceed 2^53; parse.ts turns those values into bigint. */
const BIGINT_FIELDS = new Set(['SystemAddress', 'MissionID']);

const META_KEYWORDS = new Set(['title', 'description', 'examples', 'default']);

interface Schema {
  type?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: unknown;
  items?: Schema;
  anyOf?: Schema[];
  $ref?: string;
  minItems?: number;
  maxItems?: number;
  [keyword: string]: unknown;
}

const root = resolve(import.meta.dirname, '..');
const outFile = join(root, 'src', 'shared', 'journal-events.generated.ts');
const schemaCache = new Map<string, Schema>();

function fetchSchemas(): string {
  const dir = join(root, 'node_modules', '.cache', 'ed-journal-schemas', SCHEMA_COMMIT);
  if (!existsSync(join(dir, 'schemas'))) {
    mkdirSync(dir, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', dir, ...args], { stdio: 'inherit' });
    git('init', '-q');
    git('fetch', '-q', '--depth', '1', SCHEMA_REPO, SCHEMA_COMMIT);
    git('checkout', '-q', 'FETCH_HEAD');
  }
  return join(dir, 'schemas');
}

function loadSchema(file: string): Schema {
  let schema = schemaCache.get(file);
  if (!schema) {
    schema = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Schema;
    schemaCache.set(file, schema);
  }
  return schema;
}

function resolveRef(ref: string, fromFile: string): [Schema, string] {
  const [filePart = '', pointer = ''] = ref.split('#');
  const file = filePart ? resolve(dirname(fromFile), filePart) : fromFile;
  let schema = loadSchema(file);
  for (const segment of pointer.split('/').filter(Boolean)) {
    const next = schema[segment];
    if (typeof next !== 'object' || next === null)
      throw new Error(`Bad $ref ${ref} in ${fromFile}`);
    schema = next as Schema;
  }
  return [schema, file];
}

/** Died.Killers.items lists property schemas directly instead of under "properties". */
function asBareProperties(schema: Schema): Record<string, Schema> | undefined {
  if (schema.type || schema.$ref || schema.anyOf || schema.properties || schema.items)
    return undefined;
  const entries = Object.entries(schema).filter(([key]) => !META_KEYWORDS.has(key));
  const isPropertyMap =
    entries.length > 0 &&
    entries.every(([, value]) => typeof value === 'object' && value !== null && 'type' in value);
  return isPropertyMap ? (Object.fromEntries(entries) as Record<string, Schema>) : undefined;
}

function renderType(schema: Schema, file: string, indent: string, fieldName: string): string {
  if (schema.$ref) {
    const [target, targetFile] = resolveRef(schema.$ref, file);
    return renderType(target, targetFile, indent, fieldName);
  }
  if (schema.anyOf) {
    return schema.anyOf.map((option) => renderType(option, file, indent, fieldName)).join(' | ');
  }
  switch (schema.type) {
    case 'string':
    case 'boolean':
    case 'number':
      return schema.type;
    case 'integer':
      return BIGINT_FIELDS.has(fieldName) ? 'number | bigint' : 'number';
    case 'array': {
      const item = schema.items ? renderType(schema.items, file, indent, fieldName) : 'unknown';
      if (schema.minItems !== undefined && schema.minItems === schema.maxItems) {
        return `[${Array.from({ length: schema.minItems }, () => item).join(', ')}]`;
      }
      return item.includes('|') ? `Array<${item}>` : `${item}[]`;
    }
    case 'object':
      return renderObject(schema, file, indent);
    default: {
      const properties = asBareProperties(schema);
      return properties ? renderObject({ type: 'object', properties }, file, indent) : 'unknown';
    }
  }
}

function renderObject(schema: Schema, file: string, indent: string): string {
  const properties = Object.entries(schema.properties ?? {});
  if (properties.length === 0) return 'Record<string, unknown>';
  return `{\n${renderMembers(schema, file, `${indent}  `)}\n${indent}}`;
}

function renderMembers(schema: Schema, file: string, indent: string): string {
  const required = new Set(schema.required);
  const members = Object.entries(schema.properties ?? {}).map(
    ([key, property]) =>
      `${renderDoc(property.description, indent)}${indent}${propertyKey(key)}${required.has(key) ? '' : '?'}: ${renderType(property, file, indent, key)};`,
  );
  if (schema.additionalProperties !== false) members.push(`${indent}[key: string]: unknown;`);
  return members.join('\n');
}

function propertyKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function renderDoc(description: string | undefined, indent: string): string {
  const lines = description?.trim().replaceAll('*/', '*\\/').split('\n');
  if (!lines?.length) return '';
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((line) => `${indent} * ${line}`.trimEnd()).join('\n')}\n${indent} */\n`;
}

function generate(schemaDir: string): string {
  const names = readdirSync(schemaDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(schemaDir, entry.name, `${entry.name}.json`)),
    )
    .map((entry) => entry.name)
    .toSorted();

  const events = names.map((name) => {
    const file = join(schemaDir, name, `${name}.json`);
    const schema = loadSchema(file);
    // Only declared properties are emitted, so a bogus "required" entry (GameModeChange lists
    // "Scooped", which it doesn't have) is simply ignored.
    const body = renderMembers(schema, file, '  ');
    const doc = renderDoc(schema.description, '');
    return Object.keys(schema.properties ?? {}).length === 0
      ? `${doc}export type ${name}Event = JournalEventBase<'${name}'>;`
      : `${doc}export interface ${name}Event extends JournalEventBase<'${name}'> {\n${body}\n}`;
  });

  return [
    `// Generated by scripts/generate-journal-types.ts from ${SCHEMA_REPO}`,
    `// @ ${SCHEMA_COMMIT} (Apache-2.0). Do not edit by hand.`,
    '',
    'export interface JournalEventBase<N extends string> {',
    '  /** Timestamp in UTC, ISO 8601. */',
    '  timestamp: string;',
    '  event: N;',
    '}',
    '',
    events.join('\n\n'),
    '',
    'export interface JournalEventMap {',
    ...names.map((name) => `  ${name}: ${name}Event;`),
    '}',
    '',
  ].join('\n');
}

writeFileSync(outFile, generate(fetchSchemas()));
console.log(`Wrote ${outFile}`);

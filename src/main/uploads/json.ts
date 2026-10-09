/** `JSON.rawJSON` is in V8 (and so Electron and Node 22) but not yet in TypeScript's ES2024 lib. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
const rawJSON = (JSON as unknown as { rawJSON: (text: string) => unknown }).rawJSON;

/**
 * JSON for a web service. The journal's 64-bit IDs are parsed into bigints (see `parse.ts`), which
 * `JSON.stringify` refuses; they are written back out as the plain numbers the game wrote.
 */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? rawJSON(item.toString()) : item,
  );
}

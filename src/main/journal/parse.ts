interface ReviverContext {
  source?: string;
}

const INTEGER_LITERAL = /^-?\d+$/;

/**
 * Parses a journal JSON document. Integers outside the safe range become `bigint`, so 64-bit IDs
 * (e.g. `SystemAddress`) survive intact instead of being silently rounded.
 */
export function parseJournalJson(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown, context?: ReviverContext) =>
    typeof value === 'number' &&
    !Number.isSafeInteger(value) &&
    context?.source !== undefined &&
    INTEGER_LITERAL.test(context.source)
      ? BigInt(context.source)
      : value,
  );
}

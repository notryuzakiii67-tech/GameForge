export type TextReplacement = { content: string; cursor: number };

/** Replace the current editor selection with a versioned asset placeholder. */
export function replaceWithAssetReference(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  placeholder: string,
): TextReplacement {
  const clamp = (value: number, fallback: number) => Math.max(0, Math.min(source.length, Number.isFinite(value) ? Math.floor(value) : fallback));
  const start = clamp(selectionStart, 0);
  const end = Math.max(start, clamp(selectionEnd, start));
  const content = `${source.slice(0, start)}${placeholder}${source.slice(end)}`;
  return { content, cursor: start + placeholder.length };
}

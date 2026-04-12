/**
 * Lightweight YAML parser for scenario files.
 *
 * Handles the subset of YAML used by demo scenarios: scalars, block
 * mappings, sequences of mappings, and inline flow mappings/arrays like
 * `{ width: 1280 }` or `[a, b, c]`. It's deliberately minimal — no anchors,
 * multi-document streams, or block literals — which keeps the parser small
 * enough to test exhaustively and avoids pulling in a full YAML runtime.
 */

export function parseYaml(text: string): unknown {
  const lines = text.split('\n');
  return parseLines(lines, 0, 0).value;
}

type ParseResult = { value: unknown; nextLine: number };

function parseLines(lines: string[], startLine: number, parentIndent: number): ParseResult {
  const result: Record<string, unknown> = {};
  let i = startLine;

  while (i < lines.length) {
    const raw = lines[i];

    // Skip empty lines and comments
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
      i++;
      continue;
    }

    const lineIndent = raw.length - raw.trimStart().length;

    // If we've dedented past the parent, we're done with this block
    if (lineIndent < parentIndent && i > startLine) {
      break;
    }

    const trimmed = raw.trim();

    // Sequence item (- key: value or - action: ...)
    if (trimmed.startsWith('- ')) {
      // This is a list; collect all items at this indent level
      const arr: unknown[] = [];
      while (i < lines.length) {
        const r = lines[i];
        if (r.trim() === '' || r.trim().startsWith('#')) {
          i++;
          continue;
        }
        const ind = r.length - r.trimStart().length;
        if (ind < lineIndent && i > startLine) break;
        if (ind === lineIndent && r.trim().startsWith('- ')) {
          // Parse the item as an inline mapping
          const itemContent = r.trim().slice(2); // Remove "- "
          const item: Record<string, unknown> = {};
          // Parse first key-value on the "- " line
          const kvMatch = itemContent.match(/^(\w[\w-]*):\s*(.*)/);
          if (kvMatch) {
            item[kvMatch[1]] = parseScalar(kvMatch[2]);
          }
          i++;
          // Parse continuation lines at deeper indent
          const itemIndent = lineIndent + 2;
          while (i < lines.length) {
            const sub = lines[i];
            if (sub.trim() === '' || sub.trim().startsWith('#')) {
              i++;
              continue;
            }
            const subIndent = sub.length - sub.trimStart().length;
            if (subIndent < itemIndent) break;
            const subTrimmed = sub.trim();
            const subKv = subTrimmed.match(/^(\w[\w-]*):\s*(.*)/);
            if (subKv) {
              if (subKv[2] === '' || subKv[2] === null) {
                // Nested block follows; recurse to parse it.
                i++;
                let nextSub = i;
                while (
                  nextSub < lines.length &&
                  (lines[nextSub].trim() === '' || lines[nextSub].trim().startsWith('#'))
                ) {
                  nextSub++;
                }
                if (nextSub < lines.length) {
                  const nestedIndent = lines[nextSub].length - lines[nextSub].trimStart().length;
                  if (nestedIndent > subIndent) {
                    const nested = parseLines(lines, nextSub, nestedIndent);
                    item[subKv[1]] = nested.value;
                    i = nested.nextLine;
                  } else {
                    item[subKv[1]] = null;
                  }
                } else {
                  item[subKv[1]] = null;
                }
              } else {
                item[subKv[1]] = parseScalar(subKv[2]);
                i++;
              }
            } else {
              i++;
            }
          }
          arr.push(item);
        } else {
          break;
        }
      }
      // Find the key that should hold this array by looking at the
      // last key added to result that has no value yet or return array directly
      const keys = Object.keys(result);
      const lastKey = keys[keys.length - 1];
      if (lastKey && result[lastKey] === null) {
        result[lastKey] = arr;
      } else {
        return { value: arr, nextLine: i };
      }
      continue;
    }

    // Key: value mapping
    const kvMatch = trimmed.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawValue = kvMatch[2];

      if (rawValue === '' || rawValue === null) {
        // Nested block or array follows
        result[key] = null;
        i++;
        // Check if next non-empty line is indented further
        let nextNonEmpty = i;
        while (
          nextNonEmpty < lines.length &&
          (lines[nextNonEmpty].trim() === '' || lines[nextNonEmpty].trim().startsWith('#'))
        ) {
          nextNonEmpty++;
        }
        if (nextNonEmpty < lines.length) {
          const nextIndent = lines[nextNonEmpty].length - lines[nextNonEmpty].trimStart().length;
          if (nextIndent > lineIndent) {
            const nested = parseLines(lines, nextNonEmpty, nextIndent);
            result[key] = nested.value;
            i = nested.nextLine;
          }
        }
      } else {
        result[key] = parseScalar(rawValue);
        i++;
      }
      continue;
    }

    i++;
  }

  return { value: result, nextLine: i };
}

/**
 * Split a flow-collection body (`a, b, c` inside `[...]` or `{...}`) on
 * commas while respecting quoted strings. Without this, a quoted value
 * that happens to contain a comma (e.g., `"hooks, drawer, table"`) is torn
 * into multiple entries and downstream zod validation explodes.
 *
 * Minimal state machine: track whether we're inside a single- or double-
 * quoted string and honor backslash escapes in double-quoted strings so
 * JSON-stringified values round-trip cleanly.
 */
function splitFlowCommas(inner: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      buf += ch;
      if (ch === '\\' && quote === '"' && i + 1 < inner.length) {
        buf += inner[++i];
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === ',') {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0 || parts.length > 0) parts.push(buf);
  return parts;
}

export function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();

  // Remove inline comments
  const commentFree = trimmed.replace(/\s+#.*$/, '');

  // Strip quotes
  if (
    (commentFree.startsWith('"') && commentFree.endsWith('"')) ||
    (commentFree.startsWith("'") && commentFree.endsWith("'"))
  ) {
    return commentFree.slice(1, -1);
  }

  // Flow mapping: { key: value, key: value }
  if (commentFree.startsWith('{') && commentFree.endsWith('}')) {
    const inner = commentFree.slice(1, -1);
    const obj: Record<string, unknown> = {};
    for (const part of splitFlowCommas(inner)) {
      const kv = part.trim().match(/^(\w[\w-]*):\s*(.*)/);
      if (kv) {
        obj[kv[1]] = parseScalar(kv[2]);
      }
    }
    return obj;
  }

  // Flow array: [ value, value ]
  if (commentFree.startsWith('[') && commentFree.endsWith(']')) {
    const inner = commentFree.slice(1, -1);
    return splitFlowCommas(inner).map((s) => parseScalar(s.trim()));
  }

  // Boolean
  if (commentFree === 'true') return true;
  if (commentFree === 'false') return false;

  // Null
  if (commentFree === 'null' || commentFree === '~' || commentFree === '') {
    return null;
  }

  // Number
  const num = Number(commentFree);
  if (!Number.isNaN(num) && commentFree !== '') return num;

  return commentFree;
}

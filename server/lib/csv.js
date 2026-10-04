import { StringDecoder } from 'node:string_decoder';

/**
 * Calls onLine synchronously for every line of a byte stream. Synchronous on
 * purpose: stop_times.txt has tens of millions of lines and a per-line await
 * would dominate the import time.
 */
export async function eachLine(stream, onLine) {
  const decoder = new StringDecoder('utf8');
  let rest = '';
  for await (const chunk of stream) {
    const text = rest + decoder.write(chunk);
    let start = 0;
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl === -1) break;
      const end = nl > start && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
      onLine(text.slice(start, end));
      start = nl + 1;
    }
    rest = text.slice(start);
  }
  rest += decoder.end();
  if (rest.endsWith('\r')) rest = rest.slice(0, -1);
  if (rest) onLine(rest);
}

/** Splits one CSV record (RFC 4180 quoting; no embedded line breaks). */
export function parseCsvLine(line) {
  if (line.indexOf('"') === -1) return line.split(',');
  const out = [];
  const n = line.length;
  let i = 0;
  while (i <= n) {
    if (line.charCodeAt(i) === 34) {
      let value = '';
      i++;
      for (;;) {
        const q = line.indexOf('"', i);
        if (q === -1) { value += line.slice(i); i = n + 1; break; }
        if (line.charCodeAt(q + 1) === 34) { value += line.slice(i, q + 1); i = q + 2; continue; }
        value += line.slice(i, q);
        i = q + 2; // closing quote and the separator after it
        break;
      }
      out.push(value);
    } else {
      let c = line.indexOf(',', i);
      if (c === -1) c = n;
      out.push(line.slice(i, c));
      i = c + 1;
    }
  }
  return out;
}

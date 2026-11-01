// Encoding + dash guard (D10f + owner rule 2026-11-01). Fails when a file
// under src/, prisma/, or scripts/ contains a CP1252-mojibake sequence - the
// corruption pattern where UTF-8 was once read as Windows-1252 and saved back
// (an em dash becomes a 3-char sequence of U+00E2, U+20AC, U+201D). Fixed
// wholesale on 2026-11-01 (598 sequences across 9 files, including three
// strings the model or the owner sees); this check keeps it from creeping back
// in.
//
// Detection = the same heuristic the fixer used: a char whose CP1252 byte is
// a UTF-8 lead byte (>= 0xC0) immediately followed by chars whose CP1252 bytes
// are UTF-8 continuation bytes (0x80-0xBF). Plain ASCII never matches.
//
// Run: npm run check:encoding
import { readdirSync, readFileSync, statSync } from "fs";

const dec = new TextDecoder("windows-1252");
const byteFor = new Map();
for (let b = 0x80; b < 0x100; b++) {
  const ch = dec.decode(new Uint8Array([b]));
  if (!byteFor.has(ch)) byteFor.set(ch, b);
}

function isMojibake(text) {
  for (let i = 0; i < text.length; i++) {
    const lead = byteFor.get(text[i]);
    if (lead === undefined || lead < 0xc0) continue;
    let j = i + 1;
    while (j < text.length && j - i <= 3) {
      const b = byteFor.get(text[j]);
      if (b === undefined || b < 0x80 || b > 0xbf) break;
      j++;
    }
    if (j > i + 1) return text.slice(Math.max(0, i - 20), j + 10);
  }
  return null;
}

// Guard 2 (owner rule, 2026-11-01): em dashes (U+2014) and en dashes (U+2013)
// are forbidden in code, comments, and UI strings. The regex uses escapes so
// this file itself contains no dash characters. Migration .sql files are not
// scanned (never matched by the extension filter) - they are frozen records
// whose bytes are checksummed in _prisma_migrations.
function findDash(text) {
  const idx = text.search(/[\u2014\u2013]/);
  if (idx === -1) return null;
  return text.slice(Math.max(0, idx - 20), idx + 10);
}

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = dir + "/" + name;
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (/\.(ts|tsx|prisma|mjs)$/.test(name)) {
      files.push(p);
    }
  }
}
walk("src");
walk("prisma");
walk("scripts");

let failed = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const snippet = isMojibake(text);
  if (snippet) {
    console.error("FAIL", file, "contains mojibake near:", JSON.stringify(snippet));
    failed++;
  }
  const dashSnippet = findDash(text);
  if (dashSnippet) {
    console.error(
      "FAIL",
      file,
      "contains a forbidden em/en dash (U+2014/U+2013) near:",
      JSON.stringify(dashSnippet)
    );
    failed++;
  }
}

if (failed > 0) {
  console.error(
    `${failed} violation(s). Either CP1252-mojibake (re-save as UTF-8) or a forbidden em/en dash (use a basic hyphen, comma, or period instead).`
  );
  process.exit(1);
}
console.log(`encoding ok (${files.length} files checked)`);

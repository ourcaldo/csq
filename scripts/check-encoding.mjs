// Encoding guard (D10f). Fails when a file under src/ or prisma/ contains a
// CP1252-mojibake sequence - the corruption pattern where UTF-8 was once read
// as Windows-1252 and saved back (e.g. an em dash becoming "â€”", a box rule
// becoming "â”€"). Fixed wholesale on 2026-11-01 (598 sequences across 9
// files, including three strings the model or the owner sees); this check
// keeps it from creeping back in.
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

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = dir + "/" + name;
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (/\.(ts|tsx|prisma)$/.test(name)) {
      files.push(p);
    }
  }
}
walk("src");
walk("prisma");

let failed = 0;
for (const file of files) {
  const snippet = isMojibake(readFileSync(file, "utf8"));
  if (snippet) {
    console.error("FAIL", file, "contains mojibake near:", JSON.stringify(snippet));
    failed++;
  }
}

if (failed > 0) {
  console.error(
    `${failed} file(s) contain CP1252-mojibake. The file was probably re-saved with the wrong encoding - re-save it as UTF-8.`
  );
  process.exit(1);
}
console.log(`encoding ok (${files.length} files checked)`);

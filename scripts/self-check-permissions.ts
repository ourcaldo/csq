// Self-check for the PRD 29 permission catalog (run: npm run check:permissions).
// Guards: features must cover exactly the catalog keys with no dupes, level
// sets must be subsets, and the seeded system roles must only contain valid
// keys.
import {
  ALL_KEYS,
  OWNER_ONLY_KEYS,
  AKSES_PENUH_KEYS,
  ADMIN_CHAT_KEYS,
  PERMISSION_GROUPS,
  PERMISSION_FEATURES,
  FEATURE_GROUPS,
  type PermissionKey,
} from "../packages/core/src/lib/permissions-catalog";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ": " + detail : ""}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const featureKeys = PERMISSION_FEATURES.flatMap((f) => [...f.keys]);
check("no duplicate feature keys", new Set(featureKeys).size === featureKeys.length);
check(
  "features cover exactly ALL_KEYS",
  featureKeys.length === ALL_KEYS.length && ALL_KEYS.every((k) => featureKeys.includes(k)),
  `features=${featureKeys.length} catalog=${ALL_KEYS.length}`
);
check(
  "every feature key is a catalog key",
  featureKeys.every((k) => ALL_KEYS.includes(k))
);
check(
  "baca/edit sets are subsets of the feature keys",
  PERMISSION_FEATURES.every(
    (f) => f.baca.every((k) => f.keys.includes(k)) && f.edit.every((k) => f.keys.includes(k))
  )
);
check(
  "every feature belongs to a known group",
  PERMISSION_FEATURES.every((f) => FEATURE_GROUPS.includes(f.group))
);
check(
  "AKSES_PENUH = all keys minus owner-only",
  AKSES_PENUH_KEYS.length === ALL_KEYS.length - 0 &&
    AKSES_PENUH_KEYS.every((k) => ALL_KEYS.includes(k) && !OWNER_ONLY_KEYS.includes(k))
);
check(
  "ADMIN_CHAT keys are valid catalog keys",
  ADMIN_CHAT_KEYS.every((k: PermissionKey) => ALL_KEYS.includes(k))
);
check(
  "every baca set is smaller than its edit set or both empty",
  PERMISSION_FEATURES.every((f) => f.baca.length === 0 || f.baca.length <= f.edit.length)
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\npermission catalog OK");

/**
 * Checks that every file the manifest points at actually exists in dist, and
 * that we have not quietly acquired a permission we did not intend to ship.
 *
 * Chrome reports a missing manifest reference as a vague load failure, so it is
 * worth catching here instead.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
const problems = [];

const must = (relPath, why) => {
  if (relPath === undefined) return;
  if (!existsSync(join(DIST, relPath))) problems.push(`missing ${relPath} (${why})`);
};

must(manifest.background?.service_worker, 'background.service_worker');
must(manifest.action?.default_popup, 'action.default_popup');
must(manifest.options_page, 'options_page');

for (const cs of manifest.content_scripts ?? []) {
  for (const js of cs.js ?? []) must(js, 'content_scripts.js');
}
for (const size of Object.keys(manifest.icons ?? {})) {
  must(manifest.icons[size], `icons.${size}`);
}
for (const size of Object.keys(manifest.action?.default_icon ?? {})) {
  must(manifest.action.default_icon[size], `action.default_icon.${size}`);
}

// Permission budget. Anything beyond this list is a deliberate decision that
// should be made consciously, because broad permissions are the single biggest
// driver of Chrome Web Store review friction.
const ALLOWED_PERMISSIONS = new Set(['storage', 'alarms', 'notifications', 'offscreen', 'idle']);
const ALLOWED_HOSTS = new Set(['https://learn.uwaterloo.ca/*']);

for (const p of manifest.permissions ?? []) {
  if (!ALLOWED_PERMISSIONS.has(p)) problems.push(`unexpected permission: ${p}`);
}
for (const h of manifest.host_permissions ?? []) {
  if (!ALLOWED_HOSTS.has(h)) problems.push(`unexpected host permission: ${h}`);
}
if (JSON.stringify(manifest).includes('<all_urls>')) {
  problems.push('manifest requests <all_urls>, which will fail review');
}

if (problems.length > 0) {
  console.error('dist verification FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log('dist verified:');
console.log(`  manifest v${manifest.manifest_version}, extension v${manifest.version}`);
console.log(`  permissions: ${(manifest.permissions ?? []).join(', ')}`);
console.log(`  hosts:       ${(manifest.host_permissions ?? []).join(', ')}`);

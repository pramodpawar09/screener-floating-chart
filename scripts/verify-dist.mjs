// Fails if dist/manifest.json references a file that is not in dist/ (the cause of
// "Could not load background script ''" when loading the wrong folder or a stale build).
import { readFile, access } from 'node:fs/promises';
const m = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const refs = {
  'background.service_worker': [m.background?.service_worker],
  'content_scripts.js': (m.content_scripts || []).flatMap((c) => c.js || []),
  'action.default_popup': [m.action?.default_popup],
  icons: [...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {})],
};
let bad = 0;
for (const [kind, files] of Object.entries(refs)) {
  for (const f of files) {
    const ok = !!f && (await access(`dist/${f}`).then(() => true, () => false));
    console.log(`${ok ? 'OK     ' : 'MISSING'} ${kind}: ${f || '(empty)'}`);
    if (!ok) bad++;
  }
}
if (bad) { console.error(`\n${bad} referenced file(s) missing from dist/`); process.exit(1); }
console.log('\ndist/manifest.json is consistent with dist/ contents.');

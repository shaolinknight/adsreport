// Builds the pages into dist/ : copies the page files, joins the stylesheets into one,
// and copies the scripts. Run with:  npm run build

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

export async function build() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(join(dist, 'css'), { recursive: true });

  // Pages and plain files
  for (const name of await readdir(join(src, 'pages'))) await cp(join(src, 'pages', name), join(dist, name));
  for (const name of await readdir(join(src, 'public'))) await cp(join(src, 'public', name), join(dist, name));

  // One stylesheet per kind of page, in a fixed order: the client report, and the team and admin hub.
  for (const [out, parts] of [['app.css', ['base.css', 'components.css', 'report.css']], ['hub.css', ['base.css', 'components.css', 'hub.css']]]) {
    const css = [];
    for (const name of parts) css.push(await readFile(join(src, 'css', name), 'utf8'));
    await writeFile(join(dist, 'css', out), css.join('\n'));
  }

  // The typeface, served from the same site (nothing is loaded from Google).
  await mkdir(join(dist, 'fonts'), { recursive: true });
  const fontDir = join(root, 'node_modules', '@fontsource-variable', 'figtree', 'files');
  for (const name of ['figtree-latin-wght-normal.woff2', 'figtree-latin-ext-wght-normal.woff2']) await cp(join(fontDir, name), join(dist, 'fonts', name));

  // Scripts. The report page imports the shared number logic from /lib/, so the folder layout stays the same.
  await cp(join(src, 'js'), join(dist, 'js'), { recursive: true });
  await cp(join(src, 'lib'), join(dist, 'lib'), { recursive: true });

  return dist;
}

// Run directly: node scripts/build.mjs
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().then((d) => console.log(`Built the pages into ${d}`));
}

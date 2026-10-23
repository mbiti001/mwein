import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const site = fileURLToPath(new URL('../site/', import.meta.url));
const assets = join(site, 'assets');
const shared = ['site', 'inbox', 'content'];
const tail = ['feedback', 'cookies', 'experience'];
const fingerprint = text => createHash('sha256').update(text).digest('hex').slice(0, 12);
const generated = [];
for (const [name, files] of Object.entries({ common: [...shared, ...tail], home: [...shared, 'clinic-home', ...tail, 'established'] })) {
  const css = (await Promise.all(files.map(file => readFile(join(assets, `${file}.css`), 'utf8')))).map(text => text.replace(/\r\n/g, '\n')).join('\n');
  const filename = `${name}.${fingerprint(css)}.css`;
  generated.push(filename);
  await writeFile(join(assets, filename), css);
}
// Only generated files in this fixed assets directory are removed from the checkout.
// Deploy by overlay, preserving older server assets for cached page requests.
for (const filename of await readdir(assets)) {
  if (/^(common|home)\.[a-f0-9]{12}\.css$/.test(filename) && !generated.includes(filename)) await rm(join(assets, filename));
}
const jsHashes = {};
for (const filename of await readdir(assets)) {
  if (filename.endsWith('.js')) jsHashes[filename] = fingerprint((await readFile(join(assets, filename), 'utf8')).replace(/\r\n/g, '\n'));
}
async function update(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'assets') await update(path); continue; }
    if (!/\.(html|php)$/.test(entry.name)) continue;
    let source = await readFile(path, 'utf8');
    let inserted = false;
    const bundle = generated[entry.name === 'index.html' && directory === site ? 1 : 0];
    source = source.replace(/<link rel="stylesheet" href="(\/?assets\/)(?:site|inbox|content|clinic-home|feedback|cookies|experience|established|common\.[a-f0-9]{12}|home\.[a-f0-9]{12})\.css(?:\?[^"<>]*)?">/g, (_, prefix) => {
      if (inserted) return '';
      inserted = true;
      return `<link rel="stylesheet" href="${prefix}${bundle}">`;
    });
    source = source.replace(/(<script src="\/?assets\/)([\w-]+\.js)(?:\?[^"<>]*)?(" defer><\/script>)/g,
      (match, prefix, filename, suffix) => jsHashes[filename] ? `${prefix}${filename}?v=${jsHashes[filename]}${suffix}` : match);
    await writeFile(path, source);
  }
}
await update(site);
console.log('Built CSS:', generated.join(', '));

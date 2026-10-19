import { mkdir, copyFile, access } from 'node:fs/promises';

const files = ['index.html', 'manifest.json', 'icon.svg'];
await mkdir('www', { recursive: true });
for (const file of files) {
  await access(file);
  await copyFile(file, `www/${file}`);
}
console.log('Prepared bundled DaBrawl assets:', files.join(', '));

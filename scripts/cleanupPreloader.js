const fs = require('fs');
const path = require('path');

const root = process.cwd();

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) return [full];
    return [];
  });
}

const blockRegex = /<div class="preloader-plus"[\s\S]*?<\/div>\s*<\/div>/gi;

let changed = 0;
walk(root).forEach((file) => {
  const html = fs.readFileSync(file, 'utf8');
  if (blockRegex.test(html)) {
    const updated = html.replace(blockRegex, '');
    fs.writeFileSync(file, updated, 'utf8');
    changed += 1;
  }
});

console.log(`Removed preloader markup from ${changed} files.`);

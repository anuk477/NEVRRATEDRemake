const fs = require('fs');
const path = require('path');

const root = process.cwd();

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(fullPath);
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      return [fullPath];
    }
    return [];
  });
}

function normalizeHref(href) {
  const cleaned = href.replace(/^[.\\/]*/, '').replace(/\\/g, '/');
  return cleaned.split('?')[0].replace(/^\/+/, '');
}

function adjustCssUrls(css, sourceFile) {
  const sourceDir = path.dirname(sourceFile);
  return css.replace(/url\(\s*(['"]?)(?!data:|https?:|#|\/)([^'")]+)\1\s*\)/gi, (_match, quote = '', relPath) => {
    const resolved = path.resolve(sourceDir, relPath);
    if (!resolved.startsWith(root)) {
      return _match;
    }
    const relToRoot = '/' + path.relative(root, resolved).replace(/\\/g, '/');
    return `url(${quote}${relToRoot}${quote})`;
  });
}

const htmlFiles = walk(root).sort();

const cssParts = [];
const cssPartKeys = new Set();
const jsParts = [];
const jsPartKeys = new Set();

const disallowedStyles = new Set(); // placeholder for potential exclusions
const allowedScriptSrcs = new Set([
  '/wp-content/plugins/coblocks/dist/js/vendors/tiny-swiper.js',
  '/wp-content/plugins/coblocks/dist/js/coblocks-animation.js',
  '/wp-content/plugins/coblocks/dist/js/coblocks-tinyswiper-initializer.js',
  '/wp-content/themes/go/dist/js/frontend.min.js',
]);

const allowedInlineScriptIds = new Set([
  'coblocks-tinyswiper-initializer-js-extra',
  'go-frontend-js-extra',
]);

const analyticsScriptIds = new Set([
  'jetpack-stats-js-before',
  'woocommerce-analytics-js',
  'woocommerce-analytics-client-js',
  'jetpack-stats-js',
]);

const analyticsSrcSnippets = [
  'stats.wp.com',
  'woocommerce-analytics',
  'sourcebuster',
  'tccl-tti.min.js',
];

htmlFiles.forEach((file) => {
  let html = fs.readFileSync(file, 'utf8');

  // Remove WordPress preloader markup (if present)
  html = html.replace(/<div class="preloader-plus"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/gi, '');

  // Extract inline styles
  html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
    const idMatch = attrs.match(/id\s*=\s*["']([^"']+)["']/i);
    const key = idMatch ? `style#${idMatch[1]}` : `style@${css.length}`;
    if (!disallowedStyles.has(key) && !cssPartKeys.has(key)) {
      cssParts.push(`/* From ${path.relative(root, file).replace(/\\/g, '/')} ${idMatch ? `(${idMatch[1]})` : ''} */\n${css.trim()}\n`);
      cssPartKeys.add(key);
    }
    return '';
  });

  // Extract linked stylesheets
  html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, (match) => {
    const hrefMatch = match.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) {
      return '';
    }
    const href = hrefMatch[1];
    if (/^https?:\/\//i.test(href)) {
      return '';
    }
    const normalized = '/' + normalizeHref(href);
    const filePath = path.join(root, normalizeHref(href));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      if (!cssPartKeys.has(normalized)) {
        const rawCss = fs.readFileSync(filePath, 'utf8');
        const adjustedCss = adjustCssUrls(rawCss, filePath);
        cssParts.push(`/* From ${normalized} */\n${adjustedCss.trim()}\n`);
        cssPartKeys.add(normalized);
      }
    }
    return '';
  });

  // Extract scripts
  html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, js) => {
    const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
    const idMatch = attrs.match(/id\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) {
      const src = srcMatch[1];
      if (/^https?:\/\//i.test(src)) {
        if (analyticsSrcSnippets.some((snippet) => src.includes(snippet))) {
          return '';
        }
        return '';
      }
      const normalized = '/' + normalizeHref(src);
      if (!allowedScriptSrcs.has(normalized)) {
        return '';
      }
      const scriptPath = path.join(root, normalizeHref(src));
      if (fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile()) {
        if (!jsPartKeys.has(normalized)) {
          const scriptContent = fs.readFileSync(scriptPath, 'utf8');
          jsParts.push(`// From ${normalized}\n${scriptContent.trim()}\n`);
          jsPartKeys.add(normalized);
        }
      }
      return '';
    }
    if (idMatch) {
      const id = idMatch[1];
      if (analyticsScriptIds.has(id)) {
        return '';
      }
      if (allowedInlineScriptIds.has(id) && !jsPartKeys.has(`inline#${id}`)) {
        jsParts.push(`// Inline script ${id}\n${js.trim()}\n`);
        jsPartKeys.add(`inline#${id}`);
      }
      return '';
    }
    return '';
  });

  // Remove self-closing script tags e.g. analytics without closing tag
  html = html.replace(/<script[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi, '');
  html = html.replace(/<script[^>]*src=["'][^"']+["'][^>]*\/?>/gi, '');

  const relCss = path.relative(path.dirname(file), path.join(root, 'styles.css')).replace(/\\/g, '/');
  const relJs = path.relative(path.dirname(file), path.join(root, 'script.js')).replace(/\\/g, '/');
  const cssHref = relCss || 'styles.css';
  const jsSrc = relJs || 'script.js';

  if (!/<link[^>]+href=["'][^"']*styles\.css["']/i.test(html)) {
    html = html.replace(/<\/head>/i, `  <link rel="stylesheet" href="${cssHref}">\n</head>`);
  }

  if (!/<script[^>]+src=["'][^"']*script\.js["']/i.test(html)) {
    html = html.replace(/<\/body>/i, `  <script src="${jsSrc}"></script>\n</body>`);
  }

  fs.writeFileSync(file, html, 'utf8');
});

fs.writeFileSync(path.join(root, 'styles.css'), cssParts.join('\n').trim() + '\n', 'utf8');
fs.writeFileSync(path.join(root, 'script.js'), jsParts.join('\n').trim() + '\n', 'utf8');

console.log(`Processed ${htmlFiles.length} HTML files.`);

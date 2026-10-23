// Writes one landing page per language, so each has its own address that
// search engines can index. docs/index.html is the English page and the
// template; every entry of docs/i18n.js becomes docs/<code>/index.html with
// its texts filled in. The script also fills the language links in every
// page (including the English one, in place) and writes the sitemap.
//
//   node scripts/build-landing.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SITE = 'https://mekedron.github.io/BetterYouTube/';
const docs = new URL('../docs/', import.meta.url).pathname;

const context = { window: {} };
vm.runInNewContext(readFileSync(join(docs, 'i18n.js'), 'utf8'), context);
const LANGS = context.window.LANDING_LANGUAGES;
const codes = Object.keys(LANGS);
const urlFor = (code) => (code === 'en' ? SITE : `${SITE}${code}/`);

const escapeAttr = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

function fillBlock(html, name, content) {
  const re = new RegExp(`(<!-- ${name}: [^>]*-->)[\\s\\S]*?(\\s*<!-- /${name} -->)`);
  if (!re.test(html)) throw new Error(`index.html has no ${name} block`);
  return html.replace(re, (_, open, close) => `${open}\n${content}${close}`);
}

// Replaces the inner HTML of every element with data-i18n="key" that the
// dictionary translates. Elements of the same tag may nest inside it.
function translate(html, dict) {
  const open = /<([a-z0-9]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>/g;
  let out = '';
  let cursor = 0;
  for (let m; (m = open.exec(html)); ) {
    const [tag, name, key] = m;
    const start = m.index + tag.length;
    const pair = new RegExp(`<${name}\\b|</${name}>`, 'g');
    pair.lastIndex = start;
    let depth = 1;
    let end = -1;
    for (let p; (p = pair.exec(html)); ) {
      depth += p[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = p.index;
        break;
      }
    }
    if (end < 0) throw new Error(`Unclosed <${name} data-i18n="${key}">`);
    if (key in dict) {
      out += html.slice(cursor, start) + dict[key];
      cursor = end;
      open.lastIndex = end;
    }
  }
  out += html.slice(cursor);
  return out.replace(/(<meta\b[^>]*\sdata-i18n-content="([^"]+)"[^>]*\scontent=")[^"]*"/g, (whole, head, key) =>
    key in dict ? `${head}${escapeAttr(dict[key])}"` : whole,
  );
}

function head(code) {
  const lines = [`<link rel="canonical" href="${urlFor(code)}" />`];
  for (const other of codes) lines.push(`<link rel="alternate" hreflang="${other}" href="${urlFor(other)}" />`);
  lines.push(`<link rel="alternate" hreflang="x-default" href="${SITE}" />`);
  return lines.join('\n');
}

function footer(code) {
  const root = code === 'en' ? '' : '../';
  const links = codes.map((other) => {
    const href = other === 'en' ? root || './' : `${root}${other}/`;
    const current = other === code ? ' aria-current="page"' : '';
    return `<a href="${href}" hreflang="${other}" lang="${other}"${current}>${LANGS[other].name}</a>`;
  });
  return `    <nav class="langs" aria-label="Language">${links.join(' ')}</nav>`;
}

let english = readFileSync(join(docs, 'index.html'), 'utf8');
english = fillBlock(fillBlock(english, 'languages', head('en')), 'language-links', footer('en'));
writeFileSync(join(docs, 'index.html'), english);

for (const code of codes.filter((c) => c !== 'en')) {
  let html = translate(english, LANGS[code].strings ?? {});
  html = html.replace('<html lang="en">', `<html lang="${code}" data-root="../">`);
  html = html.replace(/(src|href)="(images\/|i18n\.js)/g, '$1="../$2');
  html = fillBlock(fillBlock(html, 'languages', head(code)), 'language-links', footer(code));
  mkdirSync(join(docs, code), { recursive: true });
  writeFileSync(join(docs, code, 'index.html'), html);
}

const alternates = codes
  .map((code) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${urlFor(code)}" />`)
  .join('\n');
const urls = codes.map((code) => `  <url>\n    <loc>${urlFor(code)}</loc>\n${alternates}\n  </url>`).join('\n');
writeFileSync(
  join(docs, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`,
);
writeFileSync(join(docs, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
console.log(`Landing pages written: ${codes.join(', ')}`);

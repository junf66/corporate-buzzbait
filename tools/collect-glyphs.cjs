// Collect every character the site renders, grouped by the web-font face that draws it.
// Usage (from tools/build-fonts.py): node tools/collect-glyphs.cjs <baseURL> <out.json>
// Requires Playwright with Chromium (npm i -g playwright).
const { execSync } = require('child_process');
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');

const [base, outPath] = process.argv.slice(2);
const PAGES = ['/', '/sdgs/', '/privacy/', '/404.html'];
const WEB_FAMILIES = ['Noto Sans JP', 'Archivo', 'JetBrains Mono'];

// Strings inserted by JavaScript at runtime, with the element that displays them.
const DYNAMIC = [
  { page: '/', selector: '#clock', text: 'JST 0123456789:—' },
  { page: '/', selector: 'form button[type="submit"]', text: '送信中…送信されました ✓' },
  { page: '/', selector: '#formStatus', text: 'お問い合わせを受け付けました。ありがとうございました。送信できませんでした。時間をおいて、もう一度お試しください。' },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // Fonts are irrelevant for collecting text; skip all third-party requests.
  await page.route(url => !url.href.startsWith(base), r => r.abort());
  const groups = {};
  for (const path of PAGES) {
    await page.goto(base + path, { waitUntil: 'domcontentloaded' });
    const dynamic = DYNAMIC.filter(d => d.page === path);
    const found = await page.evaluate(({ WEB_FAMILIES, dynamic }) => {
      const out = [];
      const famList = ff => ff.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      function record(text, cs) {
        if (!text) return;
        if (cs.textTransform === 'uppercase') text = text.toUpperCase();
        else if (cs.textTransform === 'lowercase') text = text.toLowerCase();
        const fams = famList(cs.fontFamily).filter(f => WEB_FAMILIES.includes(f));
        for (const f of fams) out.push({ family: f, weight: parseInt(cs.fontWeight, 10), style: cs.fontStyle === 'italic' ? 'italic' : 'normal', text });
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('script,style,noscript,template')) continue;
        record(n.nodeValue.replace(/[\n\r\t]/g, ''), getComputedStyle(el));
      }
      for (const el of document.querySelectorAll('body *')) {
        for (const pseudo of ['::before', '::after']) {
          const cs = getComputedStyle(el, pseudo);
          const c = cs.content;
          if (c && c !== 'none' && c !== 'normal' && /^["']/.test(c)) record(c.slice(1, -1), cs);
        }
        if (el.placeholder) record(el.placeholder, getComputedStyle(el));
      }
      for (const d of dynamic) {
        const el = document.querySelector(d.selector);
        if (el) record(d.text, getComputedStyle(el));
      }
      return out;
    }, { WEB_FAMILIES, dynamic });
    for (const r of found) {
      const key = `${r.family}|${r.weight}|${r.style}`;
      groups[key] = groups[key] || new Set();
      for (const ch of r.text) groups[key].add(ch);
    }
  }
  await browser.close();
  const result = Object.entries(groups).map(([k, set]) => {
    const [family, weight, style] = k.split('|');
    return { family, weight: +weight, style, chars: [...set].sort().join('') };
  });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 1));
})().catch(e => { console.error(e); process.exit(1); });

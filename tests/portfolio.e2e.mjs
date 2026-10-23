// End-to-end test for the portfolio: every button, CTA, link and interaction.
// Run:  cd tests && npm install && node portfolio.e2e.mjs
// Uses the locally installed Google Chrome (no browser download needed).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.xml': 'application/xml', '.pdf': 'application/pdf'
};

// ---------- tiny test harness ----------
const results = [];
let currentGroup = '';
const group = (name) => { currentGroup = name; console.log(`\n▶ ${name}`); };
async function test(name, fn) {
  try {
    const note = await fn();
    results.push({ group: currentGroup, name, status: note && note.warn ? 'warn' : 'pass', note: note && note.warn });
    console.log(`  ${note && note.warn ? '⚠' : '✓'} ${name}${note && note.warn ? `  (${note.warn})` : ''}`);
  } catch (e) {
    results.push({ group: currentGroup, name, status: 'fail', note: e.message });
    console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(a === b, `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// ---------- static server ----------
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

const consoleErrors = [];
const failedLocal = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
page.on('response', r => { if (r.url().startsWith(BASE) && r.status() >= 400) failedLocal.push(`${r.status()} ${r.url()}`); });

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForSelector('#projectsGrid article');

const inViewport = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.top < innerHeight && r.bottom > 0;
}, sel);
const settle = (ms = 900) => page.waitForTimeout(ms);
const scrollTop = () => page.evaluate(() => window.scrollTo(0, 0)).then(() => settle(300));

const EXPECTED_PROJECTS = {
  meridian: { title: 'Meridian: Autonomous AI PR Reviewer', cat: 'agentic', live: false },
  aura: { title: 'Aura-Therapist: Fine-Tuned Llama-2-7B', cat: 'finetune', live: false },
  pagemind: { title: 'PageMindAI: Chrome Extension + FastAPI RAG', cat: 'rag', live: true },
  deepresearch: { title: 'Deep Research Multi-Agent System', cat: 'agentic', live: true },
  leadagent: { title: 'AI Lead Agent: B2B Outreach Automation', cat: 'agentic', live: true },
  atsanalyzer: { title: 'ATS Resume Analyzer Pro', cat: 'rag', live: false },
  moviematch: { title: 'MovieMatch: Movie Recommendation System', cat: 'ml', live: true }
};

// =====================================================================
group('Page load & integrity');
await test('page loads with title and meta description', async () => {
  assert((await page.title()).length > 5, 'empty title');
  const d = await page.getAttribute('meta[name="description"]', 'content');
  assert(d && d.length > 40, 'missing meta description');
});
await test('no console errors or uncaught exceptions', async () => {
  assert(consoleErrors.length === 0, consoleErrors.join(' | '));
});
await test('no local asset returns 4xx/5xx', async () => {
  assert(failedLocal.length === 0, failedLocal.join(', '));
});
await test('JSON-LD parses', async () => {
  const j = await page.$eval('script[type="application/ld+json"]', e => e.textContent);
  JSON.parse(j);
});
await test('no duplicate element ids', async () => {
  const dups = await page.evaluate(() => {
    const seen = {}, d = [];
    document.querySelectorAll('[id]').forEach(e => { seen[e.id] ? d.push(e.id) : (seen[e.id] = 1); });
    return d;
  });
  assert(dups.length === 0, 'duplicates: ' + dups.join(', '));
});
await test('every inline onclick handler function exists', async () => {
  const missing = await page.evaluate(() => {
    const names = new Set();
    document.querySelectorAll('[onclick]').forEach(e => {
      const m = e.getAttribute('onclick').match(/^\s*([A-Za-z_$][\w$]*)\s*\(/);
      if (m) names.add(m[1]);
    });
    return [...names].filter(n => typeof window[n] !== 'function');
  });
  assert(missing.length === 0, 'missing: ' + missing.join(', '));
});
await test('every #anchor link points at an existing element', async () => {
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href'))
      .filter(h => h.length > 1 && !document.querySelector(h)));
  assert(bad.length === 0, 'broken anchors: ' + bad.join(', '));
});
await test('all images have alt text and load', async () => {
  const bad = await page.evaluate(() => [...document.images].filter(i => !i.alt || !i.complete || i.naturalWidth === 0).map(i => i.src));
  assert(bad.length === 0, 'bad images: ' + bad.join(', '));
});
await test('hero portrait cutout is served and visible', async () => {
  const ok = await page.evaluate(() => {
    const i = document.getElementById('mainHeroImg');
    return i && i.naturalWidth > 300 && i.getBoundingClientRect().height > 200;
  });
  assert(ok, 'portrait missing or too small');
});
await test('robots.txt, sitemap.xml, llms.txt are reachable', async () => {
  for (const f of ['/robots.txt', '/sitemap.xml', '/llms.txt']) {
    const r = await fetch(BASE + f);
    assert(r.status === 200, `${f} -> ${r.status}`);
  }
});

// =====================================================================
group('Privacy & content rules');
await test('phone number does not appear anywhere on the page', async () => {
  const html = await page.content();
  assert(!/95118|9511830971|tel:/i.test(html), 'phone number found in page');
});
await test('hero section does not mention Neural Arc work', async () => {
  const hero = await page.evaluate(() => document.querySelector('main > section').innerText);
  assert(!/neural arc|byok|routing engine|8 llm|90%|80%/i.test(hero), 'hero mentions company work: ' + hero.slice(0, 120));
});
await test('experience section keeps the original facts', async () => {
  const t = await page.$eval('#experience', e => e.innerText);
  for (const needle of [
    'Full-Stack Generative AI Developer', 'Full-Stack Generative AI Developer Intern', 'AI & ML Intern', 'Data Science Intern',
    'Neural Arc Inc', 'Gradence Global (Remote, UK)', 'LLM routing engine', '8 LLM providers', '90% task success',
    'reducing incidents by 80%', '68% reply rate', 'saving 20 hours per week', 'best: 84% accuracy',
    '09/2026 – PRESENT', '06/2026 – 09/2026', '11/2025 – 05/2026', '01/2025 – 04/2025'
  ]) assert(t.includes(needle), `experience missing: "${needle}"`);
});
await test('experience has exactly 4 role cards', async () => {
  eq(await page.locator('#experience h3').count(), 4, 'role cards');
});
await test('no leftover "01" badges or demo/router section', async () => {
  const html = await page.content();
  assert(!/id="router-lab"/.test(html), 'router section still present');
  assert(!/>01<\/span>/.test(html), '"01" badge still present');
});

// =====================================================================
group('Desktop navigation');
await test('nav links exist and are underlined', async () => {
  const links = await page.$$eval('header nav a', as => as.map(a => ({ t: a.textContent.trim(), h: a.getAttribute('href'), u: getComputedStyle(a).textDecorationLine })));
  eq(links.map(l => l.t).join(','), 'Projects,Experience,Skills,Contact', 'nav labels');
  assert(links.every(l => l.u === 'underline'), 'a nav link is not underlined');
});
for (const [label, target] of [['Projects', '#projects'], ['Experience', '#experience'], ['Skills', '#skills'], ['Contact', '#contact']]) {
  await test(`nav "${label}" scrolls to ${target}`, async () => {
    await scrollTop();
    await page.click(`header nav a:has-text("${label}")`);
    await settle();
    assert(await inViewport(target), `${target} not in viewport after click`);
    assert(page.url().endsWith(target), 'hash not updated');
  });
}
await test('logo/brand link and "Resume" button are present', async () => {
  assert(await page.locator('header >> text=CHINMAY').count() > 0, 'logo missing');
});
await test('Resume button opens the Google Drive file in a new tab', async () => {
  await scrollTop();
  const a = page.locator('header a:has-text("Resume")');
  eq(await a.getAttribute('target'), '_blank', 'target');
  assert((await a.getAttribute('rel')).includes('noopener'), 'missing rel=noopener');
  const [popup] = await Promise.all([context.waitForEvent('page'), a.click()]);
  await popup.waitForLoadState('commit').catch(() => {});
  assert(/drive\.google\.com\/file\/d\/1r7vwHrLEk-II5XvGvxF6a2WcWntRnz7F/.test(popup.url()) || /accounts\.google/.test(popup.url()), 'unexpected popup url: ' + popup.url());
  await popup.close();
});

// =====================================================================
group('Hero');
await test('headline and subtext render', async () => {
  const h1 = await page.$eval('h1', e => e.innerText.replace(/\s+/g, ' '));
  eq(h1, 'Building LLM Apps That Hold Up in Production.', 'h1');
  const body = await page.$eval('main > section', e => e.innerText);
  assert(/I build RAG apps, multi-agent systems and fine-tuned models/.test(body), 'hero subtext missing');
});
await test('"Explore Projects" CTA scrolls to projects', async () => {
  await scrollTop();
  await page.click('a:has-text("Explore Projects")');
  await settle();
  assert(await inViewport('#projects'), 'projects not in viewport');
});
const slides = [
  { n: '1/3', title: 'Meridian: AI PR Reviewer', id: 'meridian' },
  { n: '2/3', title: 'Deep Research Agents', id: 'deepresearch' },
  { n: '3/3', title: 'PageMindAI', id: 'pagemind' }
];
await test('carousel: starts on slide 1/3 (Meridian)', async () => {
  await scrollTop();
  eq((await page.textContent('#heroSlideCounter')).trim(), '1/3', 'counter');
  eq((await page.textContent('#heroFeatTitle')).trim(), slides[0].title, 'title');
});
await test('carousel: next arrow changes counter, badge, name and subtitle', async () => {
  const seen = new Set();
  for (let i = 1; i <= 2; i++) {
    await page.click('button[aria-label="Next featured project"]');
    eq((await page.textContent('#heroSlideCounter')).trim(), slides[i].n, 'counter');
    eq((await page.textContent('#heroFeatTitle')).trim(), slides[i].title, 'title');
    seen.add((await page.textContent('#heroFeatSub')).trim() + '|' + (await page.textContent('#heroFeatBadge')).trim());
  }
  assert(seen.size === 2, 'subtitle/badge did not change between slides');
});
await test('carousel: wraps forward (3/3 -> 1/3) and backward (1/3 -> 3/3)', async () => {
  await page.click('button[aria-label="Next featured project"]');
  eq((await page.textContent('#heroSlideCounter')).trim(), '1/3', 'wrap forward');
  await page.click('button[aria-label="Previous featured project"]');
  eq((await page.textContent('#heroSlideCounter')).trim(), '3/3', 'wrap back');
  eq((await page.textContent('#heroFeatTitle')).trim(), slides[2].title, 'title after wrap back');
  await page.click('button[aria-label="Next featured project"]'); // back to 1/3
});
for (const [i, s] of slides.entries()) {
  await test(`carousel: "View project" on slide ${s.n} scrolls to and highlights ${s.id}`, async () => {
    await scrollTop();
    while ((await page.textContent('#heroSlideCounter')).trim() !== s.n) await page.click('button[aria-label="Next featured project"]');
    await page.click('button:has-text("View project")');
    await page.waitForTimeout(700);
    assert(await inViewport(`#proj-${s.id}`), `#proj-${s.id} not in viewport`);
    const ring = await page.$eval(`#proj-${s.id}`, e => e.classList.contains('ring-4'));
    assert(ring, 'card was not highlighted');
  });
}
await test('carousel: "View project" resets an active filter that hides the card', async () => {
  await scrollTop();
  await page.click('.proj-filter-btn[data-filter="ml"]');
  await scrollTop();
  while ((await page.textContent('#heroSlideCounter')).trim() !== '1/3') await page.click('button[aria-label="Next featured project"]');
  await page.click('button:has-text("View project")');
  await page.waitForTimeout(800);
  assert(await page.locator('#proj-meridian').count() === 1, 'meridian card not shown after filter reset');
});

// =====================================================================
group('Projects: filters');
const filterCounts = { all: 7, agentic: 3, rag: 2, ml: 1, finetune: 1 };
for (const [f, n] of Object.entries(filterCounts)) {
  await test(`filter "${f}" shows ${n} card(s) and marks the button active`, async () => {
    await page.click(`.proj-filter-btn[data-filter="${f}"]`);
    await page.waitForTimeout(200);
    eq(await page.locator('#projectsGrid article').count(), n, 'card count');
    const active = await page.$$eval('.proj-filter-btn', bs => bs.filter(b => b.classList.contains('bg-poster-navy')).map(b => b.dataset.filter));
    eq(active.join(','), f, 'active filter button');
  });
}
await test('filtered cards match their expected category', async () => {
  for (const cat of ['agentic', 'rag', 'ml', 'finetune']) {
    await page.click(`.proj-filter-btn[data-filter="${cat}"]`);
    const ids = await page.$$eval('#projectsGrid article', as => as.map(a => a.id.replace('proj-', '')));
    const want = Object.entries(EXPECTED_PROJECTS).filter(([, p]) => p.cat === cat).map(([id]) => id).sort();
    eq(ids.sort().join(','), want.join(','), `cards in ${cat}`);
  }
  await page.click('.proj-filter-btn[data-filter="all"]');
});

// =====================================================================
group('Projects: cards, popups and links');
await test('all 7 project cards render with title, summary and stack tags', async () => {
  await page.click('.proj-filter-btn[data-filter="all"]');
  for (const [id, p] of Object.entries(EXPECTED_PROJECTS)) {
    const card = page.locator(`#proj-${id}`);
    eq(await card.count(), 1, `${id} card`);
    assert((await card.locator('h3').textContent()).trim() === p.title, `${id} title mismatch`);
    assert((await card.locator('p').first().textContent()).trim().length > 20, `${id} summary empty`);
    assert(await card.locator('span.font-medium').count() >= 3, `${id} has too few stack tags`);
  }
});
for (const [id, p] of Object.entries(EXPECTED_PROJECTS)) {
  await test(`"${id}": How it works popup opens, shows details, closes with ✕ and Esc`, async () => {
    await page.click('.proj-filter-btn[data-filter="all"]');
    const card = page.locator(`#proj-${id}`);
    await card.scrollIntoViewIfNeeded();
    await card.locator('button:has-text("How it works")').click();
    const modal = page.locator('#projectModal');
    assert(await modal.isVisible(), 'popup not visible');
    eq((await page.textContent('#modalTitle')).trim(), p.title, 'popup title');
    assert((await page.locator('#modalBody li').count()) >= 2, 'popup has no highlights');
    const sourceHref = await card.locator('a:has-text("Source"), a:has-text("Model")').first().getAttribute('href');
    eq(await page.getAttribute('#modalLink', 'href'), sourceHref, 'popup source link');
    await page.click('#projectModal button[aria-label="Close"]');
    assert(!(await modal.isVisible()), 'popup did not close with ✕');
    await card.locator('button:has-text("How it works")').click();
    await page.keyboard.press('Escape');
    assert(!(await modal.isVisible()), 'popup did not close with Escape');
  });
  await test(`"${id}": Source link is external, new-tab, noopener${p.live ? '; Live/demo link present' : ''}`, async () => {
    const links = await page.$$eval(`#proj-${id} a`, as => as.map(a => ({ t: a.textContent.trim(), h: a.href, tg: a.target, rel: a.rel })));
    assert(links.length >= 1, 'no links on card');
    for (const l of links) {
      assert(/^https:\/\//.test(l.h), `non-https link ${l.h}`);
      eq(l.tg, '_blank', `target of ${l.t}`);
      assert(l.rel.includes('noopener'), `no noopener on ${l.t}`);
    }
    assert(links.some(l => /Source|Model/.test(l.t)), 'no Source/Model link');
    if (p.live) assert(links.some(l => /Live|Demo/.test(l.t)), 'no Live/Demo link');
  });
}
await test('Aura card links to the Hugging Face model', async () => {
  const h = await page.$eval('#proj-aura a:has-text("Model")', a => a.href);
  assert(h.includes('huggingface.co/psyphon1/Llama-2-7b-Therapist-Aura-Full'), h);
});

// =====================================================================
group('Skills, education & contact');
await test('skills section lists core tags', async () => {
  const t = await page.$eval('#skills', e => e.innerText);
  for (const k of ['LLMs', 'RAG Pipelines', 'Python', 'FastAPI', 'Pinecone', 'FAISS', 'Docker']) assert(t.includes(k), 'missing skill ' + k);
});
await test('education shows CGPA and SSC, no HSC tile', async () => {
  const t = await page.$eval('#skills', e => e.innerText);
  assert(t.includes('7.60') && t.includes('94.2%'), 'CGPA/SSC missing');
  assert(!/HSC/.test(t), 'HSC still shown');
});
await test('both certifications are listed', async () => {
  const t = await page.$eval('#skills', e => e.innerText);
  assert(/AZ-900/.test(t) && /Oracle Agentic AI/.test(t), 'certification missing');
});
await test('"Email Me" CTA is a mailto link to the right address', async () => {
  eq(await page.getAttribute('#contact a:has-text("Email Me")', 'href'), 'mailto:chinmayduse.sits.comp@gmail.com', 'mailto');
});
await test('footer social links point to the right profiles', async () => {
  const hrefs = await page.$$eval('#contact a[target="_blank"]', as => as.map(a => a.href));
  for (const needle of ['github.com/psyphon1', 'linkedin.com/in/chinmayduse', 'huggingface.co/psyphon1', 'leetcode.com/psyphon1'])
    assert(hrefs.some(h => h.includes(needle)), 'missing ' + needle);
});
await test('footer copyright line is clean', async () => {
  const t = await page.$eval('#contact', e => e.innerText);
  assert(t.includes('© 2026 CHINMAY DUSE'), 'copyright missing');
  assert(!/CRAFTED BY INTENTION/i.test(t.split('©')[1] || ''), 'tagline still in footer');
});

// =====================================================================
group('Responsive layout');
for (const [w, h] of [[390, 844], [768, 1024], [1280, 800], [1920, 1080]]) {
  await test(`no horizontal scroll at ${w}px`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await settle(300);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(o <= 1, `page overflows by ${o}px`);
  });
}
await test('mobile menu: button toggles, links are numbered 01-04 and navigate', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await scrollTop();
  assert(!(await page.locator('header nav').isVisible()), 'desktop nav visible on mobile');
  const btn = page.locator('#mobileMenuBtn');
  assert(await btn.isVisible(), 'hamburger hidden');
  await btn.click();
  assert(await page.locator('#mobileMenu').isVisible(), 'menu did not open');
  const labels = await page.$$eval('#mobileMenu a', as => as.map(a => a.textContent.trim()));
  eq(labels.map(l => l.slice(0, 3)).join(','), '01.,02.,03.,04.', 'menu numbering');
  await page.click('#mobileMenu a:has-text("Experience")');
  await settle();
  assert(!(await page.locator('#mobileMenu').isVisible()), 'menu did not close after click');
  assert(await inViewport('#experience'), 'experience not in view');
  await btn.click(); await btn.click();
});
await test('mobile: carousel and project popup still work', async () => {
  await scrollTop();
  await page.click('button[aria-label="Next featured project"]');
  eq((await page.textContent('#heroSlideCounter')).trim(), '2/3', 'counter on mobile');
  await page.locator('#proj-pagemind button:has-text("How it works")').scrollIntoViewIfNeeded();
  await page.click('#proj-pagemind button:has-text("How it works")');
  assert(await page.locator('#projectModal').isVisible(), 'popup not visible on mobile');
  await page.keyboard.press('Escape');
});
await page.setViewportSize({ width: 1280, height: 800 });

// =====================================================================
group('External links (HTTP check)');
const external = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="http"]')].map(a => a.href))]);
const curlStatus = (url) => {
  // curl is more tolerant than Node's fetch for some hosts; retries once on network hiccups
  const args = ['-s', '-o', '/dev/null', '-m', '25', '-L', '-A', 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36', '-w', '%{http_code} %{url_effective}', url];
  let last;
  for (let i = 0; i < 2; i++) {
    last = spawnSync('curl', args, { encoding: 'utf8' });
    if (last.status === 0) {
      const [code, ...rest] = last.stdout.split(' ');
      return { status: Number(code), url: rest.join(' ') };
    }
  }
  throw new Error(`curl failed (exit ${last.status}): ${(last.stderr || last.stdout || '').trim().slice(0, 120)}`);
};
for (const url of external) {
  await test(`reachable: ${url.length > 80 ? url.slice(0, 77) + '...' : url}`, async () => {
    if (/streamlit\.app/.test(url)) {
      // Streamlit Community Cloud redirects in a cookie loop for plain HTTP clients and answers 200 even when
      // the app is hibernated, so judge it by what a real browser shows.
      const p = await context.newPage();
      try {
        const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p.waitForTimeout(6000);
        const txt = await p.evaluate(() => document.body.innerText);
        if (/gone to sleep/i.test(txt)) return { warn: 'app is asleep (visitors see "Yes, get this app back up!"), wake it or keep it alive' };
        assert(resp && resp.status() < 400, `HTTP ${resp && resp.status()}`);
      } finally { await p.close(); }
      return;
    }
    const r = curlStatus(url);
    if (/accounts\.google\.com|ServiceLogin/.test(r.url)) throw new Error('requires sign-in (file is not public)');
    if ([401, 403, 429, 999].includes(r.status)) return { warn: `HTTP ${r.status}: site blocks bots, check manually` };
    assert(r.status > 0 && r.status < 400, `HTTP ${r.status}`);
  });
}

// ---------- summary ----------
await browser.close();
server.close();
const pass = results.filter(r => r.status === 'pass').length;
const warn = results.filter(r => r.status === 'warn').length;
const fail = results.filter(r => r.status === 'fail');
console.log('\n' + '='.repeat(60));
console.log(`TOTAL ${results.length}   PASS ${pass}   WARN ${warn}   FAIL ${fail.length}`);
if (fail.length) {
  console.log('\nFailures:');
  fail.forEach(f => console.log(` - [${f.group}] ${f.name}\n     ${f.note}`));
}
process.exit(fail.length ? 1 : 0);

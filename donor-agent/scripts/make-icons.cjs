// Draws the two app icons (manager and Areeba) and writes the SVG and PNG files.
// Run:  NODE_PATH=$(npm root -g) node scripts/make-icons.cjs   (needs Chromium; the output is committed)
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const rect = (r, fill) => `<rect width="120" height="120" rx="${r}" fill="${fill}"/>`;
const defs = `<defs>
  <linearGradient id="mbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#26356b"/><stop offset="1" stop-color="#0c1430"/></linearGradient>
  <linearGradient id="mint" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#62e0bb"/><stop offset="1" stop-color="#1f9a7a"/></linearGradient>
  <radialGradient id="abg" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#ffe4ee"/><stop offset="1" stop-color="#f4a9c4"/></radialGradient>
  <radialGradient id="fur" cx="45%" cy="38%" r="65%"><stop offset="0" stop-color="#d9a273"/><stop offset="1" stop-color="#a86a3f"/></radialGradient>
  <radialGradient id="snout" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#fbe6cf"/><stop offset="1" stop-color="#ecc9a4"/></radialGradient>
</defs>`;

// Manager: a navy tile with a clipboard and a mint tick (the person who checks the work).
const manager = (r) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${defs}${rect(r, 'url(#mbg)')}
  <rect x="31" y="24" width="58" height="76" rx="9" fill="#f2f5ff"/>
  <rect x="45" y="17" width="30" height="17" rx="6" fill="#9fb0ff"/>
  <rect x="52" y="21" width="16" height="6" rx="3" fill="#26356b"/>
  <path d="M43 62 l11 11 l22 -25" stroke="url(#mint)" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="43" y="82" width="34" height="5" rx="2.5" fill="#c4cdf5"/>
</svg>`;

// Areeba: her teddy on a pink tile.
const areeba = (r) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${defs}${rect(r, 'url(#abg)')}
  <g transform="translate(60 62) scale(.98) translate(-60 -60)">
  <circle cx="30" cy="36" r="17" fill="url(#fur)"/><circle cx="90" cy="36" r="17" fill="url(#fur)"/>
  <circle cx="30" cy="37" r="9" fill="#f3b9a6"/><circle cx="90" cy="37" r="9" fill="#f3b9a6"/>
  <ellipse cx="60" cy="66" rx="38" ry="35" fill="url(#fur)"/>
  <ellipse cx="60" cy="80" rx="17" ry="13" fill="url(#snout)"/>
  <ellipse cx="46" cy="62" rx="5.2" ry="6.2" fill="#2b1a12"/><ellipse cx="74" cy="62" rx="5.2" ry="6.2" fill="#2b1a12"/>
  <circle cx="47.8" cy="59.6" r="1.9" fill="#fff"/><circle cx="75.8" cy="59.6" r="1.9" fill="#fff"/>
  <ellipse cx="36" cy="75" rx="6.5" ry="4" fill="#ff8fb1" opacity=".55"/><ellipse cx="84" cy="75" rx="6.5" ry="4" fill="#ff8fb1" opacity=".55"/>
  <ellipse cx="60" cy="75" rx="5.5" ry="4" fill="#3a2418"/><ellipse cx="58.6" cy="73.8" rx="1.6" ry="1" fill="#fff" opacity=".7"/>
  <path d="M60 79 v3.5 M60 82.5 q-5 4.5 -9 1 M60 82.5 q5 4.5 9 1" stroke="#3a2418" stroke-width="2" fill="none" stroke-linecap="round"/>
  <g transform="translate(92 26) rotate(18)"><path d="M0 0 C-14 -10 -16 8 0 2 Z" fill="#ff5c93"/><path d="M0 0 C14 -10 16 8 0 2 Z" fill="#ff5c93"/><path d="M-2 2 L-7 12 L-1 9 Z M2 2 L7 12 L1 9 Z" fill="#e84a80"/><circle cx="0" cy="1" r="3.4" fill="#ff8fb1"/></g>
  </g>
</svg>`;

(async () => {
  const app = path.join(__dirname, '..', 'src', 'app');
  const pub = path.join(__dirname, '..', 'public');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const png = async (svg, size, file) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body>`);
    await page.screenshot({ path: file, omitBackground: true });
  };
  for (const [who, draw] of [['manager', manager], ['areeba', areeba]]) {
    fs.writeFileSync(path.join(app, who, 'icon.svg'), draw(26)); // the tab icon: rounded
    await png(draw(0), 180, path.join(app, who, 'apple-icon.png')); // iPhone rounds it itself: full square
    await png(draw(0), 192, path.join(pub, `icon-${who}-192.png`));
    await png(draw(0), 512, path.join(pub, `icon-${who}-512.png`));
  }
  await browser.close();
  console.log('icons written');
})().catch((e) => { console.error(e); process.exit(1); });

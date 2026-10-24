// Draws the two app icons (manager and Areeba): a heart, like the logo in the top bar and writes the SVG and PNG files.
// Run:  NODE_PATH=$(npm root -g) node scripts/make-icons.cjs   (needs Chromium; the output is committed)
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const HEART = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
// Same heart as the top bar. Manager: dark tile, white heart. Areeba: light tile, dark heart (easy to tell apart on a home screen).
const icon = (r, tile, heart, edge) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="${r}" fill="${tile}"${edge ? ` stroke="${edge}" stroke-width="3"` : ''}/><path transform="translate(19.2 18.5) scale(3.4)" d="${HEART}" fill="${heart}"/></svg>`;
const manager = (r) => icon(r, '#14171c', '#ffffff');
const areeba = (r) => icon(r, '#f3f4f6', '#14171c', r ? '#d5d9df' : '');

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

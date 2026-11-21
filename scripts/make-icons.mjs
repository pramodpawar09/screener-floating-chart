// Regenerates public/icons/*.png from an inline SVG. Requires `sharp` (npm i -D sharp) — only needed if you change the icon.
import sharp from 'sharp';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<rect width="128" height="128" rx="24" fill="#0f1420"/>
<g stroke-linecap="round"><g stroke="#26a69a" fill="#26a69a"><line x1="36" y1="28" x2="36" y2="100" stroke-width="6"/><rect x="26" y="48" width="20" height="34" rx="3"/></g>
<g stroke="#ef5350" fill="#ef5350"><line x1="64" y1="20" x2="64" y2="88" stroke-width="6"/><rect x="54" y="34" width="20" height="38" rx="3"/></g>
<g stroke="#26a69a" fill="#26a69a"><line x1="92" y1="36" x2="92" y2="108" stroke-width="6"/><rect x="82" y="52" width="20" height="40" rx="3"/></g></g></svg>`;
for (const s of [16, 48, 128]) await sharp(Buffer.from(svg)).resize(s, s).png().toFile(`public/icons/icon${s}.png`);
console.log('icons written');

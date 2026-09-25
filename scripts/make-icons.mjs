// Renders Armada's mark (app/icon.svg) into the icon files the site and the desktop shortcut use:
// public/icon-192.png, public/icon-512.png, public/apple-icon.png (180px) for "Add to home screen"
// and installing the site, and public/armada.ico (16–256px) for the Windows shortcut.
// usage: node scripts/make-icons.mjs
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const root = process.cwd();
const svg = fs.readFileSync(path.join(root, "app", "icon.svg"), "utf8");
const out = path.join(root, "public");
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
const page = await browser.newPage();

async function png(size, { padded = false } = {}) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  // A padded version fills the square with the mark's dark ground (phones round the corners themselves).
  const body = padded
    ? `<div style="width:${size}px;height:${size}px;background:#111418;display:grid;place-items:center">${svg.replace("<svg ", `<svg width="${Math.round(size * 0.86)}" height="${Math.round(size * 0.86)}" `)}</div>`
    : svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setContent(`<html><body style="margin:0;background:transparent">${body}</body></html>`);
  return page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

fs.writeFileSync(path.join(out, "icon-192.png"), await png(192, { padded: true }));
fs.writeFileSync(path.join(out, "icon-512.png"), await png(512, { padded: true }));
fs.writeFileSync(path.join(out, "apple-icon.png"), await png(180, { padded: true }));

// .ico with PNG images inside (Windows Vista and later read these directly).
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];
for (const s of sizes) images.push(await png(s));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
const entries = [];
let offset = 6 + 16 * images.length;
images.forEach((img, i) => {
  const e = Buffer.alloc(16);
  const s = sizes[i];
  e.writeUInt8(s >= 256 ? 0 : s, 0);
  e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt8(0, 2);
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(img.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += img.length;
  entries.push(e);
});
fs.writeFileSync(path.join(out, "armada.ico"), Buffer.concat([header, ...entries, ...images]));
await browser.close();
console.log("made public/icon-192.png, icon-512.png, apple-icon.png, armada.ico");

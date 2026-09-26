// Offline checks for search relevance (lib/catalog/relevance.ts): loose supplier results are trimmed
// to what names the thing searched for, best first, and a search never comes back empty because of it.
// The cases are modelled on real CJ results from 2026-09-25.
//
//   node scripts/check-relevance.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const report = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail !== undefined ? ` (${JSON.stringify(detail)})` : ""}`);
};
const r = await import("../lib/catalog/relevance.ts");
const t = (x) => x;

report(JSON.stringify(r.searchWords("LED Desk Lamps for the Home Office")) === JSON.stringify(["led", "desk", "lamp", "office"]), "search words: plain, singular, without filler words", r.searchWords("LED Desk Lamps for the Home Office"));
report(r.searchWords("Storage Boxes").includes("box") && r.searchWords("Batteries").includes("battery"), "plurals like boxes and batteries are read as box and battery");
report(JSON.stringify(r.searchWords("ceramic pour over coffee dripper")) === '["ceramic","coffee","dripper"]', "everyday words like over and pour don't count as search words");

// "ceramic pour over coffee dripper": CJ sent mugs and coffee sets, plus gloves, a bracelet, earrings, a coat and a helmet.
const coffee = r.rankByQuery("ceramic pour over coffee dripper", [
  "Ceramic Coffee Cup Ceramic Mug",
  "European Luxury Ceramic Coffee Set",
  "Gants pour enfant avec motif chat",
  "Bracelet En Pierre Naturelle Violet Pour Femme",
  "Fashion Jewelry Rhinestone Dripped Butterflies Stud Earrings",
  "Lapel Loose Over Knee Wool Coat",
  "French Ceramic Retro Style Coffee Set",
  "Tails Cool All Over Electric Helmet",
], t);
report(coffee.length === 3 && coffee.every((c) => /Ceramic/.test(c) && /Coffee/.test(c)), "unrelated gloves, jewellery, a coat and a helmet are dropped", coffee);

// "linen table napkins": CJ sent mostly paper napkins, and a linen table runner and tablecloth.
const napkins = r.rankByQuery("linen table napkins", [
  "Custom Printed Floral Paper Napkins, Disposable Table Napkins For Home",
  "Gold-Stamped Shell-Shaped Party Napkins",
  "Home Decoration Simple Woven Cotton And Linen Table Runner",
  "Bow-Knot Napkins Disposable Solid Color Lace Square Napkins",
  "Ins Style Cotton Linen Tablecloth Small Round Table",
], t);
report(napkins.length === 3 && napkins.every((n) => /Napkin/.test(n)), "napkins are kept, a table runner and tablecloth aren't", napkins);
report(napkins[0].startsWith("Custom Printed"), "the one that also says table comes first", napkins);

// "minimalist wooden desk organizer": CJ sent mostly office desks.
const organizers = r.rankByQuery("minimalist wooden desk organizer", [
  "Magnetic Cable Clip Under Desk Cable Management Wire Organizer",
  "Rectangle Workspace Desk,Executive Desk,Computer Desk",
  "Office Desk",
  "Book Organizer, Toy Storage Cabinet Organizer, White",
  "Kids Bookshelf And Toy Organizer, 5 Cubbies Wooden Open Bookcase",
  "Minimalist Circular Nordic Minimalist Ceiling Light",
], t);
report(organizers.length === 3 && !organizers.some((o) => /Executive|Office Desk|Ceiling/.test(o)), "desks and a ceiling light are dropped from an organizer search", organizers);

// "desk lamp": CJ's results carry both words; side-by-side ones come first.
const lamps = r.rankByQuery("desk lamp", [
  "Bedside Antique Desk BZ69 Small Table Lamp",
  "LED Rechargeable Desk Lamp Eye Protection",
  "Wireless Charger Pad",
  "LED Smart Desk Lamp Wireless Charger",
  "Changeable Shape Night Light Versatile Lamp",
], t);
report(!lamps.includes("Wireless Charger Pad") && lamps.length === 4, "a lamp search drops what isn't a lamp", lamps);
report(lamps[0] === "LED Rechargeable Desk Lamp Eye Protection" && lamps[1] === "LED Smart Desk Lamp Wireless Charger", "desk lamps come before lamps that only mention a desk, in the supplier's order", lamps);

const bottles = r.rankByQuery("bottle", ["Insulated Water Bottle 1L", "Yoga Mat Non Slip", "Glass Bottles Set", "Sports Bottle Leakproof", "Hair Clip"], t);
report(bottles.length === 3 && !bottles.includes("Yoga Mat Non Slip"), "a one-word search keeps only what carries that word", bottles);

const rare = r.rankByQuery("axolotl plush", ["Cute Axolotl Keychain", "Frog Plush Toy", "Dinosaur Figure", "Cat Mug"], t);
report(rare.length === 4 && ["Cute Axolotl Keychain", "Frog Plush Toy"].includes(rare[0]), "too few matches keeps everything, best first, never an empty page", rare);
report(r.rankByQuery("", ["a", "b"], t).length === 2 && r.rankByQuery("lamp", [], t).length === 0, "an empty search or no results pass through");
report(r.matchShare("ceramic mug", "Handmade Ceramics Coffee Mug") === 1, "close word forms count (ceramic and ceramics)");

const cj = fs.readFileSync(path.join(ROOT, "lib/catalog/cj.ts"), "utf8");
report(/rankByQuery\(phrase, found/.test(cj), "CJ searches are trimmed to what matches");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll relevance checks passed");
process.exit(failures ? 1 : 0);

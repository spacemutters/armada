// The shop builder's craft guidance: short instruction blocks added to the AI's system prompt so a
// build comes out as a real brand with a store that sells, not a template. They sit on top of the
// honesty rules in prompts.ts (SYSTEM) and never loosen them.
//
// Every block is sent with every call, so each line has to change the output. Distilled from:
// Baymard Institute's product page, cart abandonment and homepage research; Nielsen Norman Group on
// how people scan and on text over images; CXL on value propositions; the standard positioning
// statement (audience, frame of reference, point of difference, reason to believe).
//
// Which prompt takes which parts:
//   shop.concept  withCraft(SYSTEM, ["brand", "conversion"])
//   shop.products withCraft(SYSTEM, ["conversion"])
//   shop.pages    withCraft(SYSTEM, ["conversion"])
//   ab.variants   withCraft(<its system>, ["conversion"])
//   images.*      withCraft(<image system>, ["image"])   (lib/shops/images.ts does this itself)
//
// No imports, so scripts can load it offline.

export const BRAND_CRAFT = `Brand craft:
- Position first. Settle privately: for [one buyer in one situation], this is the [category] that [the one benefit this range gives]. Every field follows from it; a line that could belong to any shop in the category is wrong.
- audience: a person in a situation ("first-time dog owners in a city apartment"), not an age bracket.
- brandName: at most 10 letters, spellable after hearing it once, taken from the product's world: a material, place, motion, tool, or a coined word with the right sound. Never describe the category ("PetGearPro"), never a trend suffix (-ify, -ly, -io, -hub). alternativeNames take different routes (one evocative, one coined), not variations of one idea.
- tagline: the position in plain, concrete words. No puns, no filler ("for every lifestyle", "quality you can trust").
- voice: one thing it always does and one it never does, so a writer can follow it.
- palette: start from two or three real materials the products are made of or used among, at their quietest for background and surface; ink is a deep tinted neutral, never pure black; the accent is the single saturated note, and not the category's default (teal or blue for fitness and tech, leaf green for natural, pink for beauty). Premium shows as restraint: fewer colors, lower saturation, more space.
- fonts: the display face carries the character (a serif for craft, calm or heritage; a grotesque for technical, athletic or modern); the body face stays plain. Never pair two expressive faces.
- hero.headline: the outcome the buyer gets, in their words: what changes after buying, never a restatement of the category. hero.subhead: what is sold and for whom, so a stranger understands the shop in five seconds. hero.cta: a verb plus the range ("Shop the bedding"), never "Learn more" or "Discover".
- valueProps: three different kinds of reason (the range, the use, the shop's true terms), each with one specific detail, none repeating the headline.
- collections: named by what the shopper is trying to do or where it happens ("Sleep", "On the walk"), 1-3 words, no overlap, most-wanted first.`;

export const CONVERSION_CRAFT = `Conversion craft (every claim still comes only from the data and facts you are given):
- Clarity beats cleverness. Shoppers scan, and they buy what they understand fastest. One promise and one action per screen; nothing competes with them.
- Product titles: what it is plus the detail that decides the choice (size, material, count), in the shopper's words.
- Descriptions: the first sentence says what gets easier for the buyer and where it fits; the rest gives the facts that make that true. If a sentence would fit another product, cut it.
- Bullets: 3-5, each opens with the fact in two to four words, then what it means for the buyer ("Machine washable: goes in with the towels"). Put the deciding fact first (size or fit, material, what's included, care). Say plainly what is included and what is not.
- Specific beats superlative: numbers, materials, dimensions and counts from the data. If shoppers need a detail the data lacks (size, compatibility), leave it out; never guess.
- Lower the risk with true terms only: the delivery window, the returns window, who pays return shipping and how to reach the shop, in plain words, stated the same way everywhere, close to the decision.
- Collection descriptions: one line on who it is for or what it solves, so a shopper knows which to open.
- Suggest a pairing only when the products are used together, and name the reason in a phrase.
- FAQ: answer the questions that stop a purchase (fit or size, delivery time, returns, what's in the box, care), with the answer in the first sentence.
- Never write reviews, ratings, customer counts, "best seller", discounts, sale or crossed-out prices, "limited", stock levels, countdowns, badges, guarantees or pressure to buy now. Trust comes from specifics and true terms.`;

export const IMAGE_CRAFT = `Image craft (you write the prompt for one brand image):
- Honesty: brand images show the shop's world (place, light, materials, the moment of use). They never show a product the shop sells, any item of that kind, packaging, or anything a shopper could take for what they will receive. Product photos stay the supplier's real photos.
- Never text, letters, numbers, logos, labels, watermarks or screens. No face toward the camera: people appear only from behind, cropped, or as hands and silhouettes, so no one reads as a real customer.
- One idea per image: a specific place and time ("a narrow city kitchen at 7 a.m."), one subject, generous calm space. Name the surfaces, the light source and the season.
- Light is what looks expensive: soft directional daylight, long gentle shadows. No flat studio light, no HDR, no lens flare.
- Color: from the brand palette, named as materials with their hex ("chalk-white walls #f2f1ec"); low saturation, one accent note, natural color, fine film grain.
- Camera: realistic editorial photography, 35-50 mm, eye or chest height, shallow depth of field. Not illustration or 3D render unless the brand's look asks for it.
- Composition follows the slot: hero is wide 3:2, the left 40% calm and plain for a headline, one clear subject just right of center so a tall 4:5 crop keeps it; a collection cover is square, one still life or setting that says what the collection is for, readable at 300 px.
- Avoid the stock look: no posed smiles, thumbs up, laptops on beds, floating objects, glossy skin or surreal mashups.
- A set is one shoot: the same light, palette, lens and grain in every image.
- Write the prompt as short labelled lines: Scene, Subject, Light, Camera, Palette, Composition, Do not include (repeat the no-product, no-text and no-face rules and name the shop's product kinds).`;

export type CraftPart = "brand" | "conversion" | "image";

const BLOCKS: Record<CraftPart, string> = { brand: BRAND_CRAFT, conversion: CONVERSION_CRAFT, image: IMAGE_CRAFT };

/**
 * The system prompt with the chosen craft blocks added, in the order brand, conversion, image.
 * They go before a closing "Answer only with JSON" line, so the output rule stays last. A block
 * already present is not added twice.
 */
export function withCraft(system: string, parts: CraftPart[]): string {
  const blocks = (["brand", "conversion", "image"] as const)
    .filter((p) => parts.includes(p))
    .map((p) => BLOCKS[p])
    .filter((b) => !system.includes(b.slice(0, b.indexOf("\n"))));
  if (!blocks.length) return system;
  const craft = blocks.join("\n\n");
  const lines = system.trimEnd().split("\n");
  const last = lines.at(-1) ?? "";
  if (/^Answer only with JSON/i.test(last.trim()) && lines.length > 1) {
    return `${lines.slice(0, -1).join("\n").trimEnd()}\n\n${craft}\n\n${last}`;
  }
  return `${system.trimEnd()}\n\n${craft}`;
}

// Brand names that make a listing a trademark risk unless the shop sells for that brand.
// Supplier titles sometimes carry them ("for iPhone", "Nike style"); those items are flagged and
// score lower, and the listing rule refuses them.
const BRANDS = [
  "apple", "iphone", "ipad", "airpods", "macbook", "samsung", "galaxy", "nike", "adidas", "jordan", "puma", "reebok",
  "gucci", "louis vuitton", "chanel", "dior", "prada", "hermes", "hermès", "versace", "balenciaga", "burberry", "fendi",
  "rolex", "cartier", "tiffany", "ray-ban", "rayban", "oakley", "north face", "supreme", "lululemon", "under armour",
  "disney", "marvel", "pokemon", "pokémon", "lego", "barbie", "hello kitty", "star wars", "harry potter", "nintendo",
  "playstation", "xbox", "sony", "bose", "beats", "dyson", "stanley", "yeti", "owala", "hydro flask", "crocs", "ugg",
  "converse", "vans", "new balance", "skechers", "coach", "michael kors", "kate spade", "pandora", "swarovski",
];

const pattern = new RegExp(`(^|[^a-z])(${BRANDS.map((b) => b.replace(/[-]/g, "[- ]?")).join("|")})([^a-z]|$)`, "i");

export function mentionsBrand(text: string): string | null {
  const m = pattern.exec(text);
  return m ? m[2] : null;
}

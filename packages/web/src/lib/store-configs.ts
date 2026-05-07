/**
 * Static lookup of valid store slugs per country.
 * Derived from packages/scraper/stores/{country}/*.json at build time.
 *
 * A store is "valid" if a config JSON exists for it, even before the scraper
 * has produced any catalogs. This allows store pages to render a friendly
 * empty state rather than a hard 404.
 *
 * To regenerate: list all *.json filenames (sans extension) in each country dir.
 */
export const STORE_CONFIGS: Record<string, readonly string[]> = {
  austria: ["action", "dm", "fressnapf", "hofer", "jysk", "lidl", "norma"],
  belgium: ["action", "action-fr", "aldi", "carrefour", "delhaize", "jysk", "lidl", "maxi-zoo"],
  bosnia: ["bingo", "dm", "pepco"],
  bulgaria: ["dm", "jysk", "kaufland", "pepco"],
  croatia: ["dm", "jysk", "kaufland", "konzum", "lidl", "mueller", "pepco", "plodine"],
  czechia: ["action", "albert", "billa", "dm", "jysk", "kaufland", "lidl", "norma", "penny", "pepco", "rossmann"],
  denmark: ["bauhaus", "bilka", "foetex", "jysk", "lidl", "netto", "rema-1000", "superbrugsen"],
  estonia: ["coop", "lidl", "maxima", "pepco", "rimi"],
  finland: ["intersport", "jysk", "lidl", "s-market", "tokmanni"],
  france: ["action", "aldi", "carrefour", "conforama", "jysk", "lidl", "maxi-zoo", "norma"],
  germany: ["action", "aldi-sued", "decathlon", "fressnapf", "hornbach", "jysk", "kaufland", "lidl", "mediamarkt", "metro", "mueller", "netto", "norma", "pepco"],
  greece: ["jysk", "lidl"],
  hungary: ["aldi", "dm", "fressnapf", "jysk", "lidl", "penny", "pepco"],
  ireland: ["aldi", "jysk", "lidl"],
  italy: ["action", "aldi", "carrefour", "jysk", "lidl", "pepco"],
  latvia: ["jysk", "lidl", "maxima", "pepco", "rimi"],
  lithuania: ["jysk", "lidl", "maxima", "pepco", "rimi"],
  netherlands: ["action", "aldi", "jumbo", "jysk", "kruidvat", "lidl", "maxi-zoo", "plus"],
  norway: ["jysk", "kiwi", "meny", "rema-1000"],
  poland: ["action", "aldi", "jysk", "kaufland", "lidl", "maxi-zoo", "netto", "obi", "rossmann"],
  portugal: ["aldi", "continente", "jysk", "lidl", "pingo-doce"],
  romania: ["animax", "auchan", "carrefour", "jysk", "kaufland", "la-doi-pasi", "lidl", "mega-image", "metro", "penny", "pepco", "selgros"],
  serbia: ["aman", "dm", "lidl", "pepco"],
  slovakia: ["action", "billa", "dm", "kaufland", "pepco"],
  slovenia: ["dm", "hofer", "jysk", "lidl", "mueller", "pepco"],
  spain: ["action", "aldi", "carrefour", "decathlon", "jysk", "lidl", "pepco"],
  sweden: ["bauhaus", "coop", "jysk", "lidl", "willys"],
  switzerland: ["aldi-suisse", "fressnapf", "jysk", "lidl"],
  uk: ["aldi", "bm", "jysk", "lidl"],
};

/**
 * Returns true if a store config exists for the given country+store slug,
 * regardless of whether the scraper has produced any catalogs yet.
 */
export function storeConfigExists(country: string, store: string): boolean {
  const stores = STORE_CONFIGS[country];
  return stores !== undefined && stores.includes(store);
}

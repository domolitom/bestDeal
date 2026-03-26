export interface Country {
  code: string; // "romania", "germany", "poland"
  name: string; // "Romania", "Germany", "Poland"
  flag: string; // "🇷🇴", "🇩🇪", "🇵🇱"
  storeCount: number;
  catalogCount: number;
}

/**
 * Maps legacy or incorrectly-stored country strings to their canonical COUNTRY_META keys.
 * Used to repair data already in R2 that was written under a wrong country name.
 * Example: catalogs stored with country "united-kingdom" are normalised to "uk".
 */
export const COUNTRY_CODE_ALIASES: Record<string, string> = {
  "united-kingdom": "uk",
  "great-britain": "uk",
  "czech-republic": "czechia",
};

export const COUNTRY_META: Record<string, { name: string; flag: string }> = {
  romania: { name: "Romania", flag: "\u{1F1F7}\u{1F1F4}" },
  germany: { name: "Germany", flag: "\u{1F1E9}\u{1F1EA}" },
  france: { name: "France", flag: "\u{1F1EB}\u{1F1F7}" },
  poland: { name: "Poland", flag: "\u{1F1F5}\u{1F1F1}" },
  hungary: { name: "Hungary", flag: "\u{1F1ED}\u{1F1FA}" },
  bulgaria: { name: "Bulgaria", flag: "\u{1F1E7}\u{1F1EC}" },
  czechia: { name: "Czechia", flag: "\u{1F1E8}\u{1F1FF}" },
  croatia: { name: "Croatia", flag: "\u{1F1ED}\u{1F1F7}" },
  austria: { name: "Austria", flag: "\u{1F1E6}\u{1F1F9}" },
  spain: { name: "Spain", flag: "\u{1F1EA}\u{1F1F8}" },
  italy: { name: "Italy", flag: "\u{1F1EE}\u{1F1F9}" },
  uk: { name: "United Kingdom", flag: "\u{1F1EC}\u{1F1E7}" },
  ireland: { name: "Ireland", flag: "\u{1F1EE}\u{1F1EA}" },
  finland: { name: "Finland", flag: "\u{1F1EB}\u{1F1EE}" },
  netherlands: { name: "Netherlands", flag: "\u{1F1F3}\u{1F1F1}" },
  belgium: { name: "Belgium", flag: "\u{1F1E7}\u{1F1EA}" },
  portugal: { name: "Portugal", flag: "\u{1F1F5}\u{1F1F9}" },
  slovenia: { name: "Slovenia", flag: "\u{1F1F8}\u{1F1EE}" },
  denmark: { name: "Denmark", flag: "\u{1F1E9}\u{1F1F0}" },
  sweden: { name: "Sweden", flag: "\u{1F1F8}\u{1F1EA}" },
  norway: { name: "Norway", flag: "\u{1F1F3}\u{1F1F4}" },
  switzerland: { name: "Switzerland", flag: "\u{1F1E8}\u{1F1ED}" },
  serbia: { name: "Serbia", flag: "\u{1F1F7}\u{1F1F8}" },
  slovakia: { name: "Slovakia", flag: "\u{1F1F8}\u{1F1F0}" },
  greece: { name: "Greece", flag: "\u{1F1EC}\u{1F1F7}" },
  lithuania: { name: "Lithuania", flag: "\u{1F1F1}\u{1F1F9}" },
  latvia: { name: "Latvia", flag: "\u{1F1F1}\u{1F1FB}" },
  estonia: { name: "Estonia", flag: "\u{1F1EA}\u{1F1EA}" },
};

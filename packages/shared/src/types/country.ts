export interface Country {
  code: string; // "romania", "germany", "poland"
  name: string; // "Romania", "Germany", "Poland"
  flag: string; // "🇷🇴", "🇩🇪", "🇵🇱"
  storeCount: number;
  catalogCount: number;
}

export const COUNTRY_META: Record<string, { name: string; flag: string }> = {
  romania: { name: "Romania", flag: "\u{1F1F7}\u{1F1F4}" },
  germany: { name: "Germany", flag: "\u{1F1E9}\u{1F1EA}" },
  poland: { name: "Poland", flag: "\u{1F1F5}\u{1F1F1}" },
  hungary: { name: "Hungary", flag: "\u{1F1ED}\u{1F1FA}" },
  bulgaria: { name: "Bulgaria", flag: "\u{1F1E7}\u{1F1EC}" },
  czechia: { name: "Czechia", flag: "\u{1F1E8}\u{1F1FF}" },
};

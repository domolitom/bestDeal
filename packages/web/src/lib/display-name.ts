/**
 * Convert a store/country slug to a human-readable display name.
 * "mega-image" → "Mega Image"
 * "aldi-sued"  → "Aldi Sued"
 */
export function toDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

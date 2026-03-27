export interface ResolvedPage {
  number: number;
  imageUrl: string;
  /** Pre-rendered image data (skips download). Used by PDF resolver. */
  imageData?: Buffer;
}

export interface ResolveResult {
  catalogId: string;
  coverImageUrl: string;
  /** URL of a smaller thumbnail image for the cover (e.g. 400-600px wide). */
  coverThumbUrl?: string;
  pages: ResolvedPage[];
}

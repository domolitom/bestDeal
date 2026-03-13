export interface ResolvedPage {
  number: number;
  imageUrl: string;
  /** Pre-rendered image data (skips download). Used by PDF resolver. */
  imageData?: Buffer;
}

export interface ResolveResult {
  catalogId: string;
  coverImageUrl: string;
  pages: ResolvedPage[];
}

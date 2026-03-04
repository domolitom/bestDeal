export interface ResolvedPage {
  number: number;
  imageUrl: string;
}

export interface ResolveResult {
  catalogId: string;
  coverImageUrl: string;
  pages: ResolvedPage[];
}

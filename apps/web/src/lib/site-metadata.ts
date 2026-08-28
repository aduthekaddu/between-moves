/**
 * Shared, canonical site metadata for Between Moves.
 * Public identity per docs/product-and-mvp.md (Name, Tagline, Promise).
 */
export const siteMetadata = {
  name: 'Between Moves',
  tagline: 'Your chess house.',
  description: 'Keep a small group playing together every week.',
} as const;

export type SiteMetadata = typeof siteMetadata;

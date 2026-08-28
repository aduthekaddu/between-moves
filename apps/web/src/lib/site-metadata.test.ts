import { describe, expect, it } from 'vitest';
import { siteMetadata } from './site-metadata';

describe('siteMetadata', () => {
  it('carries the canonical public identity', () => {
    expect(siteMetadata.name).toBe('Between Moves');
    expect(siteMetadata.tagline).toBe('Your chess house.');
  });

  it('exposes a non-empty description', () => {
    expect(siteMetadata.description.length).toBeGreaterThan(0);
  });
});

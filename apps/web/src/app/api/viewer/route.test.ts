import { AuthenticationRequiredError, type AuthenticatedViewer } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createViewerResponse } from './route';

const authenticatedViewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000001',
  displayName: 'Ada',
  imageUrl: null,
};

describe('GET /api/viewer', () => {
  it('[BM-007] returns the authenticated viewer with private cache controls', async () => {
    const request = new Request('https://betweenmoves.example.test/api/viewer');
    const response = await createViewerResponse(
      request,
      vi.fn().mockResolvedValue(authenticatedViewer),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ viewer: authenticatedViewer });
  });

  it('[BM-007] rejects anonymous access with an RFC 9457 authentication problem', async () => {
    const request = new Request('https://betweenmoves.example.test/api/viewer');
    const response = await createViewerResponse(
      request,
      vi.fn().mockRejectedValue(new AuthenticationRequiredError()),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    await expect(response.json()).resolves.toMatchObject({
      type: 'https://betweenmoves.app/problems/unauthenticated',
      status: 401,
      code: 'unauthenticated',
      instance: '/api/viewer',
    });
  });
});

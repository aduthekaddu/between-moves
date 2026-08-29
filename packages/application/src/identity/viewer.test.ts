import { AuthenticationRequiredError, type SessionIdentityReader } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createViewerResolver } from './viewer';

describe('Identity viewer resolution', () => {
  it('[BM-007] [DR-ID-01] resolves a valid session to an authenticated viewer', async () => {
    const sessions: SessionIdentityReader<Request> = {
      read: vi.fn().mockResolvedValue({
        userId: '01941f29-7c00-7000-8000-000000000001',
        displayName: 'Ada',
        imageUrl: 'https://images.example.test/ada.png',
      }),
    };
    const request = new Request('https://betweenmoves.example.test/private');

    await expect(createViewerResolver(sessions).getViewer(request)).resolves.toEqual({
      kind: 'authenticated',
      userId: '01941f29-7c00-7000-8000-000000000001',
      displayName: 'Ada',
      imageUrl: 'https://images.example.test/ada.png',
    });
    expect(sessions.read).toHaveBeenCalledWith(request);
  });

  it('[BM-007] [DR-ID-01] resolves a missing or invalid session to an anonymous viewer', async () => {
    const sessions: SessionIdentityReader<Request> = {
      read: vi.fn().mockResolvedValue(null),
    };

    await expect(
      createViewerResolver(sessions).getViewer(
        new Request('https://betweenmoves.example.test/private'),
      ),
    ).resolves.toEqual({ kind: 'anonymous' });
  });

  it('[BM-007] requires an authenticated viewer and rejects anonymous access', async () => {
    const sessions: SessionIdentityReader<Request> = {
      read: vi.fn().mockResolvedValue(null),
    };

    await expect(
      createViewerResolver(sessions).requireViewer(
        new Request('https://betweenmoves.example.test/private'),
      ),
    ).rejects.toBeInstanceOf(AuthenticationRequiredError);
  });
});

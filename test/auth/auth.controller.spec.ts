import { AuthController } from '../../src/auth/auth.controller';
import { SupabaseService } from '../../src/supabase/supabase.service';

describe('AuthController', () => {
  let controller: AuthController;
  let queryMock: jest.Mock;

  beforeEach(() => {
    queryMock = jest.fn();
    const supabase = {
      db: { query: queryMock },
    } as unknown as SupabaseService;
    controller = new AuthController(supabase);
  });

  it('returns authenticated user profile info', async () => {
    const mockProfile = {
      user_id: '123e4567-e89b-12d3-a456-426614174000',
      display_name: 'Nguyễn Văn A',
      avatar_url: 'https://example.com/avatar.jpg',
      created_at: new Date('2026-01-01'),
    };
    queryMock.mockResolvedValueOnce({ rows: [mockProfile] });

    const result = await controller.getMe({
      id: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(result).toEqual({
      id: '123e4567-e89b-12d3-a456-426614174000',
      displayName: 'Nguyễn Văn A',
      avatarUrl: 'https://example.com/avatar.jpg',
      createdAt: mockProfile.created_at,
    });
    expect(queryMock).toHaveBeenCalledWith(expect.any(String), [
      '123e4567-e89b-12d3-a456-426614174000',
    ]);
  });

  it('handles user with no profile record gracefully', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await controller.getMe({
      id: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(result).toEqual({
      id: '123e4567-e89b-12d3-a456-426614174000',
      displayName: null,
      avatarUrl: null,
      createdAt: null,
    });
  });
});

import { BadRequestException } from '@nestjs/common';
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
      email: null,
      displayName: 'Nguyễn Văn A',
      avatarUrl: 'https://example.com/avatar.jpg',
      createdAt: mockProfile.created_at,
      updatedAt: null,
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
      email: null,
      displayName: null,
      avatarUrl: null,
      createdAt: null,
      updatedAt: null,
    });
  });

  it('registers user and saves to both auth.users and public.profiles tables', async () => {
    const mockCreated = {
      user_id: '123e4567-e89b-12d3-a456-426614174000',
      display_name: 'Google User',
      avatar_url: 'https://lh3.googleusercontent.com/avatar.jpg',
      created_at: new Date('2026-01-01'),
    };
    // First query for auth.users, second query for public.profiles
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [mockCreated] });

    const result = await controller.register({
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'user@gmail.com',
      displayName: 'Google User',
      avatarUrl: 'https://lh3.googleusercontent.com/avatar.jpg',
    });

    expect(result.success).toBe(true);
    expect(result.profile).toEqual({
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'user@gmail.com',
      displayName: 'Google User',
      avatarUrl: 'https://lh3.googleusercontent.com/avatar.jpg',
      createdAt: mockCreated.created_at,
      updatedAt: expect.any(Date),
    });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('throws BadRequestException if user id is missing on register', async () => {
    await expect(
      controller.register({ id: '', email: 'test@example.com' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('checkUser', () => {
    it('throws BadRequestException if neither id nor email provided', async () => {
      await expect(controller.checkUser(undefined, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('returns exists true when user profile is found by id', async () => {
      const mockProfile = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'user@example.com',
        display_name: 'Test User',
        avatar_url: 'https://example.com/avatar.jpg',
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-02'),
      };
      queryMock.mockResolvedValueOnce({ rows: [mockProfile] });

      const result = await controller.checkUser('123e4567-e89b-12d3-a456-426614174000');
      expect(result.exists).toBe(true);
      expect(result.profile?.id).toBe(mockProfile.user_id);
      expect(result.profile?.email).toBe(mockProfile.email);
    });

    it('returns exists false when user is not found', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      const result = await controller.checkUser(undefined, 'nonexistent@example.com');
      expect(result.exists).toBe(false);
      expect(result.profile).toBeNull();
    });
  });
});

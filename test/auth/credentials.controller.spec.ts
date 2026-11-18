import { CredentialsController } from '../../src/auth/credentials.controller';

describe('CredentialsController', () => {
  const profile = {
    id: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
    email: 'an@gmail.com',
    displayName: 'An',
    avatarUrl: null,
  };
  let service: {
    register: jest.Mock;
    login: jest.Mock;
    changePassword: jest.Mock;
  };
  let controller: CredentialsController;

  beforeEach(() => {
    service = {
      register: jest.fn().mockResolvedValue(profile),
      login: jest.fn().mockResolvedValue(profile),
      changePassword: jest.fn().mockResolvedValue(undefined),
    };
    controller = new CredentialsController(service as any);
  });

  it('register forwards email, password and displayName', async () => {
    await expect(
      controller.register({
        email: 'an@gmail.com',
        password: 'matkhau123',
        displayName: 'An',
      }),
    ).resolves.toEqual(profile);
    expect(service.register).toHaveBeenCalledWith(
      'an@gmail.com',
      'matkhau123',
      'An',
    );
  });

  it('login forwards email and password', async () => {
    await expect(
      controller.login({ email: 'an@gmail.com', password: 'matkhau123' }),
    ).resolves.toEqual(profile);
    expect(service.login).toHaveBeenCalledWith('an@gmail.com', 'matkhau123');
  });

  it('changePassword uses the authenticated user id and returns success', async () => {
    await expect(
      controller.changePassword(
        { id: profile.id },
        { currentPassword: 'matkhau123', newPassword: 'matkhaumoi1' },
      ),
    ).resolves.toEqual({ success: true });
    expect(service.changePassword).toHaveBeenCalledWith(
      profile.id,
      'matkhau123',
      'matkhaumoi1',
    );
  });
});

import {
  BadRequestException,
  ConflictException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  CredentialsService,
  LOCK_MINUTES,
  MAX_FAILED_ATTEMPTS,
} from '../../src/auth/credentials.service';
import { Profile } from '../../src/database/entities/profile.entity';
import { UserCredential } from '../../src/database/entities/user-credential.entity';

jest.setTimeout(30000);

const USER_ID = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('CredentialsService', () => {
  let passwordHash: string;
  let credRepo: {
    findOne: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  let profileRepo: { findOne: jest.Mock };
  let manager: { insert: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let service: CredentialsService;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('matkhau123', 4);
  });

  beforeEach(() => {
    credRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
    };
    profileRepo = {
      findOne: jest.fn().mockResolvedValue({
        userId: USER_ID,
        email: 'an@gmail.com',
        displayName: 'An',
        avatarUrl: null,
      }),
    };
    manager = { insert: jest.fn().mockResolvedValue(undefined) };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };
    service = new CredentialsService(
      credRepo as any,
      profileRepo as any,
      dataSource as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function credential(overrides: Partial<UserCredential> = {}) {
    return {
      userId: USER_ID,
      email: 'an@gmail.com',
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null,
      ...overrides,
    };
  }

  describe('register', () => {
    it('rejects when a profile email matches case-insensitively', async () => {
      dataSource.query.mockResolvedValueOnce([{ user_id: USER_ID }]);

      await expect(
        service.register(' an@gmail.com ', 'matkhau123', 'An'),
      ).rejects.toEqual(new ConflictException('Email đã được sử dụng'));

      const [sql, params] = dataSource.query.mock.calls[0];
      expect(sql).toMatch(/lower\(email\)\s*=\s*\$1/i);
      expect(params).toEqual(['an@gmail.com']);
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('creates profile with credentials provider and hashed password', async () => {
      const result = await service.register('An@Gmail.com', 'matkhau123', 'An');

      expect(result.email).toBe('an@gmail.com');
      expect(result.displayName).toBe('An');
      expect(result.avatarUrl).toBeNull();
      expect(result.id).toMatch(UUID_RE);

      const profileInsert = manager.insert.mock.calls.find(
        ([entity]) => entity === Profile,
      );
      expect(profileInsert[1]).toMatchObject({
        userId: result.id,
        email: 'an@gmail.com',
        displayName: 'An',
        authProviders: ['credentials'],
      });

      const credInsert = manager.insert.mock.calls.find(
        ([entity]) => entity === UserCredential,
      );
      expect(credInsert[1]).toMatchObject({
        userId: result.id,
        email: 'an@gmail.com',
      });
      expect(credInsert[1].passwordHash).not.toBe('matkhau123');
      expect(
        await bcrypt.compare('matkhau123', credInsert[1].passwordHash),
      ).toBe(true);
    });

    it('maps unique violation 23505 to ConflictException', async () => {
      manager.insert.mockRejectedValueOnce({ code: '23505' });

      await expect(
        service.register('an@gmail.com', 'matkhau123', 'An'),
      ).rejects.toEqual(new ConflictException('Email đã được sử dụng'));
    });

    it('rejects passwords longer than 72 bytes', async () => {
      await expect(
        service.register('an@gmail.com', 'ă'.repeat(40), 'An'),
      ).rejects.toEqual(new BadRequestException('Mật khẩu quá dài'));
      expect(manager.insert).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('succeeds with normalized email and resets counters', async () => {
      credRepo.findOne.mockResolvedValueOnce(credential({ failedAttempts: 3 }));

      const result = await service.login('  An@Gmail.com ', 'matkhau123');

      expect(credRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'an@gmail.com' },
      });
      expect(result).toEqual({
        id: USER_ID,
        email: 'an@gmail.com',
        displayName: 'An',
        avatarUrl: null,
      });
      expect(credRepo.update).toHaveBeenCalledWith(
        { userId: USER_ID },
        { failedAttempts: 0, lockedUntil: null },
      );
    });

    it('throws UnauthorizedException for unknown email', async () => {
      await expect(
        service.login('nobody@gmail.com', 'matkhau123'),
      ).rejects.toEqual(
        new UnauthorizedException('Email hoặc mật khẩu không đúng'),
      );
    });

    it('increments failedAttempts on wrong password', async () => {
      credRepo.findOne.mockResolvedValueOnce(credential());

      await expect(
        service.login('an@gmail.com', 'sai-mat-khau'),
      ).rejects.toEqual(
        new UnauthorizedException('Email hoặc mật khẩu không đúng'),
      );
      expect(credRepo.update).toHaveBeenCalledWith(
        { userId: USER_ID },
        { failedAttempts: 1 },
      );
    });

    it('locks for 15 minutes on the fifth wrong password', async () => {
      const now = new Date('2026-11-18T10:00:00Z');
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      jest.setSystemTime(now);
      credRepo.findOne.mockResolvedValueOnce(
        credential({ failedAttempts: MAX_FAILED_ATTEMPTS - 1 }),
      );

      await expect(
        service.login('an@gmail.com', 'sai-mat-khau'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(MAX_FAILED_ATTEMPTS).toBe(5);
      expect(LOCK_MINUTES).toBe(15);
      expect(credRepo.update).toHaveBeenCalledWith(
        { userId: USER_ID },
        {
          failedAttempts: 0,
          lockedUntil: new Date(now.getTime() + 15 * 60 * 1000),
        },
      );
    });

    it('throws 423 AccountLocked while locked, even with the correct password', async () => {
      credRepo.findOne.mockResolvedValueOnce(
        credential({ lockedUntil: new Date(Date.now() + 60_000) }),
      );

      const error = await service
        .login('an@gmail.com', 'matkhau123')
        .catch((e) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(423);
      expect(error.message).toBe('AccountLocked');
    });

    it('allows login once the lock has expired', async () => {
      credRepo.findOne.mockResolvedValueOnce(
        credential({ lockedUntil: new Date(Date.now() - 60_000) }),
      );

      await expect(
        service.login('an@gmail.com', 'matkhau123'),
      ).resolves.toMatchObject({ id: USER_ID });
    });
  });

  describe('changePassword', () => {
    it('throws when the account has no password', async () => {
      await expect(
        service.changePassword(USER_ID, 'matkhau123', 'matkhaumoi1'),
      ).rejects.toEqual(new BadRequestException('Tài khoản chưa có mật khẩu'));
    });

    it('throws UnauthorizedException when the current password is wrong', async () => {
      credRepo.findOne.mockResolvedValueOnce(credential());

      await expect(
        service.changePassword(USER_ID, 'sai-mat-khau', 'matkhaumoi1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(credRepo.update).not.toHaveBeenCalled();
    });

    it('rejects new passwords longer than 72 bytes', async () => {
      credRepo.findOne.mockResolvedValueOnce(credential());

      await expect(
        service.changePassword(USER_ID, 'matkhau123', 'ă'.repeat(40)),
      ).rejects.toEqual(new BadRequestException('Mật khẩu quá dài'));
    });

    it('stores a new hash matching the new password', async () => {
      credRepo.findOne.mockResolvedValueOnce(credential());

      await service.changePassword(USER_ID, 'matkhau123', 'matkhaumoi1');

      expect(credRepo.findOne).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
      const [where, patch] = credRepo.update.mock.calls[0];
      expect(where).toEqual({ userId: USER_ID });
      expect(await bcrypt.compare('matkhaumoi1', patch.passwordHash)).toBe(
        true,
      );
    });
  });

  describe('hasPassword', () => {
    it('returns true when a credential exists', async () => {
      credRepo.count.mockResolvedValueOnce(1);
      await expect(service.hasPassword(USER_ID)).resolves.toBe(true);
      expect(credRepo.count).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
    });

    it('returns false otherwise', async () => {
      await expect(service.hasPassword(USER_ID)).resolves.toBe(false);
    });
  });
});

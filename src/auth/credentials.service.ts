import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { Profile } from '../database/entities/profile.entity';
import { UserCredential } from '../database/entities/user-credential.entity';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

export const BCRYPT_COST = 10;
const MAX_PASSWORD_BYTES = 72;
const INVALID_CREDENTIALS = 'Email hoặc mật khẩu không đúng';
const EMAIL_IN_USE = 'Email đã được sử dụng';

// Compared against when the email is unknown so response time does not reveal
// whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('qlct-dummy-password', BCRYPT_COST);

export type CredentialProfile = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertPasswordLength(password: string): void {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new BadRequestException('Mật khẩu quá dài');
  }
}

@Injectable()
export class CredentialsService {
  constructor(
    @InjectRepository(UserCredential)
    private readonly credRepo: Repository<UserCredential>,
    @InjectRepository(Profile)
    private readonly profileRepo: Repository<Profile>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<CredentialProfile> {
    const normalizedEmail = normalizeEmail(email);
    assertPasswordLength(password);

    const existing = await this.dataSource.query(
      `select user_id from public.profiles where lower(email) = $1 limit 1`,
      [normalizedEmail],
    );
    if (existing.length > 0) {
      throw new ConflictException(EMAIL_IN_USE);
    }

    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const name = displayName.trim();

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.insert(Profile, {
          userId,
          email: normalizedEmail,
          displayName: name,
          avatarUrl: null,
          authProviders: ['credentials'],
        });
        await manager.insert(UserCredential, {
          userId,
          email: normalizedEmail,
          passwordHash,
        });
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') {
        throw new ConflictException(EMAIL_IN_USE);
      }
      throw error;
    }

    return {
      id: userId,
      email: normalizedEmail,
      displayName: name,
      avatarUrl: null,
    };
  }

  async login(email: string, password: string): Promise<CredentialProfile> {
    const normalizedEmail = normalizeEmail(email);
    const credential = await this.credRepo.findOne({
      where: { email: normalizedEmail },
    });

    if (!credential) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (
      credential.lockedUntil &&
      credential.lockedUntil.getTime() > Date.now()
    ) {
      throw new HttpException('AccountLocked', 423);
    }

    const valid = await bcrypt.compare(password, credential.passwordHash);

    // Counter and lock are read-modify-written in one SQL statement so that
    // concurrent attempts cannot all observe the same pre-lock counter. The
    // `locked_until` guard also makes any attempt that finishes after another
    // request locked the account report 423, even with the correct password.
    if (!valid) {
      const rows = await this.dataSource.query(
        `with u as (
           update public.user_credentials
           set failed_attempts = case when failed_attempts + 1 >= $2 then 0 else failed_attempts + 1 end,
               locked_until = case when failed_attempts + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end,
               updated_at = now()
           where user_id = $1 and (locked_until is null or locked_until <= now())
           returning failed_attempts, locked_until
         )
         select * from u`,
        [credential.userId, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
      );
      if (rows.length === 0) {
        throw new HttpException('AccountLocked', 423);
      }
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const reset = await this.dataSource.query(
      `with u as (
         update public.user_credentials
         set failed_attempts = 0, locked_until = null, updated_at = now()
         where user_id = $1 and (locked_until is null or locked_until <= now())
         returning user_id
       )
       select * from u`,
      [credential.userId],
    );
    if (reset.length === 0) {
      throw new HttpException('AccountLocked', 423);
    }

    const profile = await this.profileRepo.findOne({
      where: { userId: credential.userId },
    });
    return {
      id: credential.userId,
      email: profile?.email ?? credential.email,
      displayName: profile?.displayName ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const credential = await this.credRepo.findOne({ where: { userId } });
    if (!credential) {
      throw new BadRequestException('Tài khoản chưa có mật khẩu');
    }
    const valid = await bcrypt.compare(
      currentPassword,
      credential.passwordHash,
    );
    if (!valid) {
      throw new BadRequestException('Mật khẩu hiện tại không đúng');
    }
    assertPasswordLength(newPassword);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.credRepo.update({ userId }, { passwordHash });
  }

  async hasPassword(userId: string): Promise<boolean> {
    return (await this.credRepo.count({ where: { userId } })) > 0;
  }
}

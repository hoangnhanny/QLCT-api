import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { SignJWT } from 'jose';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { getPool, resetDb } from './db';

jest.setTimeout(60000);

const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ??
  'super-secret-jwt-token-with-at-least-32-characters-long';

async function mintToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

describe('Credentials (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await resetDb();
    await getPool().end();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
  });

  const register = (body: object) =>
    request(app.getHttpServer()).post('/auth/credentials/register').send(body);
  const login = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/auth/credentials/login')
      .send({ email, password });

  it('registers once, rejects a duplicate email with 409', async () => {
    const res = await register({
      email: 'An@Gmail.com',
      password: 'matkhau123',
      displayName: 'An',
    }).expect(201);
    expect(res.body.email).toBe('an@gmail.com');

    const dup = await register({
      email: 'an@gmail.com',
      password: 'matkhau456',
      displayName: 'Ai đó',
    }).expect(409);
    expect(dup.body.message).toBe('Email đã được sử dụng');
  });

  it('locks the account after 5 wrong passwords', async () => {
    await register({
      email: 'an@gmail.com',
      password: 'matkhau123',
      displayName: 'An',
    }).expect(201);

    for (let i = 0; i < 5; i++) {
      await login('an@gmail.com', 'sai-mat-khau').expect(401);
    }
    const locked = await login('an@gmail.com', 'matkhau123').expect(423);
    expect(locked.body.message).toBe('AccountLocked');
  });

  it('Google registration with the same email merges into the credential account', async () => {
    const created = await register({
      email: 'binh@gmail.com',
      password: 'matkhau123',
      displayName: 'Bình',
    }).expect(201);

    const oauth = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ id: randomUUID(), email: 'binh@gmail.com', provider: 'google' })
      .expect(201);
    expect(oauth.body.profile.id).toBe(created.body.id);

    const check = await request(app.getHttpServer())
      .get('/auth/check-user')
      .query({ email: 'binh@gmail.com', provider: 'google' })
      .expect(200);
    expect(check.body.exists).toBe(true);
    expect(check.body.profile.authProviders).toEqual(
      expect.arrayContaining(['credentials', 'google']),
    );
  });

  it('changes the password and reports hasPassword on /auth/me', async () => {
    const created = await register({
      email: 'chi@gmail.com',
      password: 'matkhau123',
      displayName: 'Chi',
    }).expect(201);
    const token = await mintToken(created.body.id);

    await request(app.getHttpServer())
      .patch('/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'matkhau123', newPassword: 'matkhaumoi1' })
      .expect(200, { success: true });

    await login('chi@gmail.com', 'matkhaumoi1').expect(200);
    await login('chi@gmail.com', 'matkhau123').expect(401);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.hasPassword).toBe(true);
  });

  it('rejects invalid bodies with 400', async () => {
    await register({
      email: 'not-an-email',
      password: 'matkhau123',
      displayName: 'X',
    }).expect(400);
    await register({
      email: 'an@gmail.com',
      password: 'short',
      displayName: 'X',
    }).expect(400);
    await register({ email: 'an@gmail.com', password: 'matkhau123' }).expect(
      400,
    );
  });
});

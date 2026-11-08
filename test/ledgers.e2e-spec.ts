import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SignJWT } from 'jose';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestUser, getPool, resetDb } from './db';

const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ??
  'super-secret-jwt-token-with-at-least-32-characters-long';

async function mintToken(userId: string): Promise<string> {
  return new SignJWT({
    sub: userId,
    user_metadata: { full_name: 'Test User' },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

describe('Ledgers (e2e)', () => {
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

  it('GET /ledgers without a token returns 401', async () => {
    await request(app.getHttpServer()).get('/ledgers').expect(401);
  });

  it('POST /ledgers with an invalid token returns 401', async () => {
    await request(app.getHttpServer())
      .post('/ledgers')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ kind: 'family', name: 'Nhà' })
      .expect(401);
  });

  it('a member can create a ledger, list it, and see its seeded categories', async () => {
    const owner = await createTestUser('owner');
    const token = await mintToken(owner);

    const createRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'business', name: 'Quán' })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/ledgers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);

    const categoriesRes = await request(app.getHttpServer())
      .get(`/ledgers/${createRes.body.id}/categories`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(categoriesRes.body).toHaveLength(7);
  });

  it('non-member gets 403 accessing a ledger', async () => {
    const owner = await createTestUser('owner2');
    const outsider = await createTestUser('outsider');
    const ownerToken = await mintToken(owner);
    const outsiderToken = await mintToken(outsider);

    const createRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ kind: 'family', name: 'Nhà' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/ledgers/${createRes.body.id}/members`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  it('unknown ledger returns 404', async () => {
    const user = await createTestUser('user404');
    const token = await mintToken(user);

    await request(app.getHttpServer())
      .get('/ledgers/00000000-0000-0000-0000-000000000000/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});

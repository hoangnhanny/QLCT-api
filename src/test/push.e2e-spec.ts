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

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('Push (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key-value';
    process.env.VAPID_PRIVATE_KEY = 'test-vapid-private-key-value';
    process.env.VAPID_SUBJECT = 'mailto:admin@example.com';

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

  it('GET /push/public-key returns the configured VAPID public key', async () => {
    const res = await request(app.getHttpServer())
      .get('/push/public-key')
      .expect(200);

    expect(res.body).toEqual({
      publicKey: 'test-vapid-public-key-value',
    });
  });

  it('unauthenticated POST or DELETE /push/subscriptions returns 401', async () => {
    await request(app.getHttpServer())
      .post('/push/subscriptions')
      .send({
        endpoint: 'https://push.example.com/sub/1',
        keys: { p256dh: 'k1', auth: 'a1' },
      })
      .expect(401);

    await request(app.getHttpServer())
      .delete('/push/subscriptions')
      .send({ endpoint: 'https://push.example.com/sub/1' })
      .expect(401);
  });

  it('user can subscribe and unsubscribe', async () => {
    const userId = await createTestUser('push-user');
    const token = await mintToken(userId);

    // 1. Subscribe
    await request(app.getHttpServer())
      .post('/push/subscriptions')
      .set(auth(token))
      .send({
        endpoint: 'https://push.example.com/sub/user-device-1',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0484TagBEQZs6zSmSzGWqZGhizxOW2Elvj5080Ap2Ot8',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      })
      .expect(201);

    // Verify in db
    const dbRes = await getPool().query(
      `SELECT * FROM public.push_subscriptions WHERE user_id = $1`,
      [userId],
    );
    expect(dbRes.rows).toHaveLength(1);
    expect(dbRes.rows[0].endpoint).toBe('https://push.example.com/sub/user-device-1');

    // 2. Subscribe same endpoint again -> upsert, still 1 row
    await request(app.getHttpServer())
      .post('/push/subscriptions')
      .set(auth(token))
      .send({
        endpoint: 'https://push.example.com/sub/user-device-1',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0484TagBEQZs6zSmSzGWqZGhizxOW2Elvj5080Ap2Ot8',
          auth: 'new-auth-key',
        },
      })
      .expect(201);

    const dbResAfterUpdate = await getPool().query(
      `SELECT * FROM public.push_subscriptions WHERE user_id = $1`,
      [userId],
    );
    expect(dbResAfterUpdate.rows).toHaveLength(1);
    expect(dbResAfterUpdate.rows[0].auth).toBe('new-auth-key');

    // 3. Unsubscribe
    await request(app.getHttpServer())
      .delete('/push/subscriptions')
      .set(auth(token))
      .send({ endpoint: 'https://push.example.com/sub/user-device-1' })
      .expect(200);

    const dbResAfterDelete = await getPool().query(
      `SELECT * FROM public.push_subscriptions WHERE user_id = $1`,
      [userId],
    );
    expect(dbResAfterDelete.rows).toHaveLength(0);
  });
});

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

function authHeader(token: string): string {
  return 'Bearer ' + token;
}

describe('Invites (e2e)', () => {
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

  it('admin can create and revoke an invite; non-admin gets 403 creating one', async () => {
    const admin = await createTestUser('admin');
    const member = await createTestUser('member');
    const adminToken = await mintToken(admin);
    const memberToken = await mintToken(member);

    const createRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set('Authorization', authHeader(adminToken))
      .send({ kind: 'family', name: 'Nhà' })
      .expect(201);
    const ledgerId = createRes.body.id;

    await getPool().query(
      `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
      [ledgerId, member],
    );

    await request(app.getHttpServer())
      .post(`/ledgers/${ledgerId}/invites`)
      .set('Authorization', authHeader(memberToken))
      .expect(403);

    const inviteRes = await request(app.getHttpServer())
      .post(`/ledgers/${ledgerId}/invites`)
      .set('Authorization', authHeader(adminToken))
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/ledgers/${ledgerId}/invites/${inviteRes.body.id}`)
      .set('Authorization', authHeader(adminToken))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/invites/${inviteRes.body.token}`)
      .expect(410);
  });

  it("cannot revoke another ledger's invite via a different ledger's route", async () => {
    const admin = await createTestUser('admin');
    const token = await mintToken(admin);

    const ledgerARes = await request(app.getHttpServer())
      .post('/ledgers')
      .set('Authorization', authHeader(token))
      .send({ kind: 'family', name: 'Nhà A' })
      .expect(201);
    const ledgerBRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set('Authorization', authHeader(token))
      .send({ kind: 'family', name: 'Nhà B' })
      .expect(201);

    const inviteRes = await request(app.getHttpServer())
      .post(`/ledgers/${ledgerARes.body.id}/invites`)
      .set('Authorization', authHeader(token))
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/ledgers/${ledgerBRes.body.id}/invites/${inviteRes.body.id}`)
      .set('Authorization', authHeader(token))
      .expect(404);

    // Still valid: the link belongs to ledger A, untouched by the ledger B
    // revoke attempt.
    await request(app.getHttpServer())
      .get(`/invites/${inviteRes.body.token}`)
      .expect(200);
  });

  it('GET /invites/:token is public and only returns ledgerName and kind', async () => {
    const admin = await createTestUser('admin');
    const token = await mintToken(admin);

    const ledgerRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set('Authorization', authHeader(token))
      .send({ kind: 'business', name: 'Quán' })
      .expect(201);

    const inviteRes = await request(app.getHttpServer())
      .post(`/ledgers/${ledgerRes.body.id}/invites`)
      .set('Authorization', authHeader(token))
      .expect(201);

    const previewRes = await request(app.getHttpServer())
      .get(`/invites/${inviteRes.body.token}`)
      .expect(200);

    expect(previewRes.body).toEqual({ ledgerName: 'Quán', kind: 'business' });
  });

  it('GET /invites/:token for an unknown token returns 404', async () => {
    await request(app.getHttpServer())
      .get('/invites/does-not-exist')
      .expect(404);
  });

  it('accept requires auth and adds an active membership', async () => {
    const admin = await createTestUser('admin');
    const newcomer = await createTestUser('newcomer');
    const adminToken = await mintToken(admin);
    const newcomerToken = await mintToken(newcomer);

    const ledgerRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set('Authorization', authHeader(adminToken))
      .send({ kind: 'family', name: 'Nhà' })
      .expect(201);

    const inviteRes = await request(app.getHttpServer())
      .post(`/ledgers/${ledgerRes.body.id}/invites`)
      .set('Authorization', authHeader(adminToken))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/invites/${inviteRes.body.token}/accept`)
      .expect(401);

    const acceptRes = await request(app.getHttpServer())
      .post(`/invites/${inviteRes.body.token}/accept`)
      .set('Authorization', authHeader(newcomerToken))
      .expect(201);
    expect(acceptRes.body.id).toBe(ledgerRes.body.id);

    const membersRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerRes.body.id}/members`)
      .set('Authorization', authHeader(adminToken))
      .expect(200);
    const member = membersRes.body.find((m: any) => m.userId === newcomer);
    expect(member?.status).toBe('active');
  });

  it('accept for an expired invite does not create a membership', async () => {
    const admin = await createTestUser('admin');
    const newcomer = await createTestUser('newcomer');
    const adminToken = await mintToken(admin);
    const newcomerToken = await mintToken(newcomer);

    const ledgerRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set('Authorization', authHeader(adminToken))
      .send({ kind: 'family', name: 'Nhà' })
      .expect(201);

    const inviteRes = await request(app.getHttpServer())
      .post(`/ledgers/${ledgerRes.body.id}/invites`)
      .set('Authorization', authHeader(adminToken))
      .expect(201);

    await getPool().query(
      `update public.invites set expires_at = now() - interval '1 day' where id = $1`,
      [inviteRes.body.id],
    );

    await request(app.getHttpServer())
      .post(`/invites/${inviteRes.body.token}/accept`)
      .set('Authorization', authHeader(newcomerToken))
      .expect(410);

    const membersRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerRes.body.id}/members`)
      .set('Authorization', authHeader(adminToken))
      .expect(200);
    expect(
      membersRes.body.find((m: any) => m.userId === newcomer),
    ).toBeUndefined();
  });
});

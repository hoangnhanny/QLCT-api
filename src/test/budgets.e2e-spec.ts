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

describe('Budgets (e2e)', () => {
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

  it('unauthenticated request returns 401', async () => {
    await request(app.getHttpServer())
      .get('/ledgers/00000000-0000-0000-0000-000000000000/budgets')
      .expect(401);
  });

  it('non-member returns 403', async () => {
    const ownerId = await createTestUser('owner');
    const ownerToken = await mintToken(ownerId);
    const outsiderId = await createTestUser('outsider');
    const outsiderToken = await mintToken(outsiderId);

    const ledgerRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set(auth(ownerToken))
      .send({ kind: 'family', name: 'Gia đình' })
      .expect(201);

    const ledgerId = ledgerRes.body.id;

    await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/budgets?month=2026-11`)
      .set(auth(outsiderToken))
      .expect(403);
  });

  it('non-admin member cannot upsert or delete budgets (403)', async () => {
    const adminId = await createTestUser('admin');
    const adminToken = await mintToken(adminId);
    const memberId = await createTestUser('member');
    const memberToken = await mintToken(memberId);

    const ledgerRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set(auth(adminToken))
      .send({ kind: 'family', name: 'Gia đình' })
      .expect(201);
    const ledgerId = ledgerRes.body.id;

    await getPool().query(
      `INSERT INTO public.members (ledger_id, user_id, status) VALUES ($1, $2, 'active')`,
      [ledgerId, memberId],
    );

    // Non-admin attempts to upsert budget -> 403
    await request(app.getHttpServer())
      .put(`/ledgers/${ledgerId}/budgets`)
      .set(auth(memberToken))
      .send({
        month: '2026-11-01',
        amount: 5000000,
      })
      .expect(403);

    // Admin creates budget
    const budgetRes = await request(app.getHttpServer())
      .put(`/ledgers/${ledgerId}/budgets`)
      .set(auth(adminToken))
      .send({
        month: '2026-11-01',
        amount: 5000000,
      })
      .expect(200);

    const budgetId = budgetRes.body.id;

    // Non-admin attempts to delete budget -> 403
    await request(app.getHttpServer())
      .delete(`/ledgers/${ledgerId}/budgets/${budgetId}`)
      .set(auth(memberToken))
      .expect(403);
  });

  it('admin can upsert (create & update), list, and delete budgets', async () => {
    const adminId = await createTestUser('admin');
    const adminToken = await mintToken(adminId);
    const memberId = await createTestUser('member');
    const memberToken = await mintToken(memberId);

    const ledgerRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set(auth(adminToken))
      .send({ kind: 'family', name: 'Gia đình' })
      .expect(201);
    const ledgerId = ledgerRes.body.id;

    await getPool().query(
      `INSERT INTO public.members (ledger_id, user_id, status) VALUES ($1, $2, 'active')`,
      [ledgerId, memberId],
    );

    // Get a seeded category
    const categoriesRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/categories`)
      .set(auth(adminToken))
      .expect(200);
    const categoryId = categoriesRes.body[0].id;

    // 1. Create total ledger budget
    const totalBudgetRes = await request(app.getHttpServer())
      .put(`/ledgers/${ledgerId}/budgets`)
      .set(auth(adminToken))
      .send({
        month: '2026-11-01',
        amount: 10000000,
      })
      .expect(200);

    expect(totalBudgetRes.body.amount).toBe(10000000);
    expect(totalBudgetRes.body.memberUserId).toBeNull();
    expect(totalBudgetRes.body.categoryId).toBeNull();
    const totalBudgetId = totalBudgetRes.body.id;

    // 2. Upsert same key with new amount -> updates existing row
    const updatedTotalBudgetRes = await request(app.getHttpServer())
      .put(`/ledgers/${ledgerId}/budgets`)
      .set(auth(adminToken))
      .send({
        month: '2026-11-01',
        amount: 15000000,
      })
      .expect(200);

    expect(updatedTotalBudgetRes.body.id).toBe(totalBudgetId);
    expect(updatedTotalBudgetRes.body.amount).toBe(15000000);

    // 3. Create category budget
    const catBudgetRes = await request(app.getHttpServer())
      .put(`/ledgers/${ledgerId}/budgets`)
      .set(auth(adminToken))
      .send({
        categoryId,
        month: '2026-11-01',
        amount: 4000000,
      })
      .expect(200);
    expect(catBudgetRes.body.categoryId).toBe(categoryId);

    // 4. Create member-specific budget
    const memberBudgetRes = await request(app.getHttpServer())
      .put(`/ledgers/${ledgerId}/budgets`)
      .set(auth(adminToken))
      .send({
        memberUserId: memberId,
        month: '2026-11-01',
        amount: 3000000,
      })
      .expect(200);
    expect(memberBudgetRes.body.memberUserId).toBe(memberId);

    // 5. Member reads budget list
    const listRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/budgets?month=2026-11`)
      .set(auth(memberToken))
      .expect(200);

    expect(listRes.body).toHaveLength(3);

    // 6. Admin deletes member budget
    await request(app.getHttpServer())
      .delete(`/ledgers/${ledgerId}/budgets/${memberBudgetRes.body.id}`)
      .set(auth(adminToken))
      .expect(200);

    // 7. Verify list now has 2
    const listAfterDelete = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/budgets?month=2026-11`)
      .set(auth(memberToken))
      .expect(200);

    expect(listAfterDelete.body).toHaveLength(2);
  });
});

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

describe('Expenses (e2e)', () => {
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
      .get('/ledgers/00000000-0000-0000-0000-000000000000/expenses')
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
      .get(`/ledgers/${ledgerId}/expenses`)
      .set(auth(outsiderToken))
      .expect(403);
  });

  it('creates expenses in batch and lists them with joined category and creator', async () => {
    const ownerId = await createTestUser('owner');
    const ownerToken = await mintToken(ownerId);

    const ledgerRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set(auth(ownerToken))
      .send({ kind: 'family', name: 'Gia đình' })
      .expect(201);

    const ledgerId = ledgerRes.body.id;

    // Get seeded categories
    const categoriesRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/categories`)
      .set(auth(ownerToken))
      .expect(200);

    const categoryId = categoriesRes.body[0].id;

    // Batch create
    const createRes = await request(app.getHttpServer())
      .post(`/ledgers/${ledgerId}/expenses`)
      .set(auth(ownerToken))
      .send({
        items: [
          {
            amount: 50000,
            content: 'Ăn sáng Phở',
            categoryId,
            spentAt: '2026-11-05T01:00:00Z',
          },
          {
            amount: 25000,
            content: 'Cà phê sáng',
            spentAt: '2026-11-05T02:00:00Z',
          },
        ],
      })
      .expect(201);

    expect(createRes.body).toHaveLength(2);
    expect(createRes.body[0].amount).toBe(25000); // newest spent_at first
    expect(createRes.body[1].amount).toBe(50000);
    expect(createRes.body[1].category.id).toBe(categoryId);

    // List expenses
    const listRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/expenses?month=2026-11`)
      .set(auth(ownerToken))
      .expect(200);

    expect(listRes.body).toHaveLength(2);
    expect(listRes.body[0].content).toBe('Cà phê sáng');
    expect(listRes.body[1].content).toBe('Ăn sáng Phở');
  });

  it('Review Focus: Asia/Ho_Chi_Minh timezone boundary (2026-11-30T17:30Z is Dec 1st UTC+7)', async () => {
    const ownerId = await createTestUser('owner');
    const ownerToken = await mintToken(ownerId);

    const ledgerRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set(auth(ownerToken))
      .send({ kind: 'family', name: 'Nhà' })
      .expect(201);

    const ledgerId = ledgerRes.body.id;

    // Spent at 00:30 UTC+7 on Dec 1st
    await request(app.getHttpServer())
      .post(`/ledgers/${ledgerId}/expenses`)
      .set(auth(ownerToken))
      .send({
        items: [
          {
            amount: 100000,
            content: 'Đầu tháng 12',
            spentAt: '2026-11-30T17:30:00Z',
          },
        ],
      })
      .expect(201);

    // Query November 2026: should be empty
    const novRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/expenses?month=2026-11`)
      .set(auth(ownerToken))
      .expect(200);
    expect(novRes.body).toHaveLength(0);

    // Query December 2026: should contain the expense
    const decRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/expenses?month=2026-12`)
      .set(auth(ownerToken))
      .expect(200);
    expect(decRes.body).toHaveLength(1);
    expect(decRes.body[0].content).toBe('Đầu tháng 12');
  });

  it('rejects batch if any category belongs to another ledger (atomic rollback)', async () => {
    const ownerId = await createTestUser('owner');
    const ownerToken = await mintToken(ownerId);

    const ledger1Res = await request(app.getHttpServer())
      .post('/ledgers')
      .set(auth(ownerToken))
      .send({ kind: 'family', name: 'Nhà 1' })
      .expect(201);

    const ledger2Res = await request(app.getHttpServer())
      .post('/ledgers')
      .set(auth(ownerToken))
      .send({ kind: 'family', name: 'Nhà 2' })
      .expect(201);

    const cats2 = await request(app.getHttpServer())
      .get(`/ledgers/${ledger2Res.body.id}/categories`)
      .set(auth(ownerToken))
      .expect(200);

    const catFromLedger2 = cats2.body[0].id;

    await request(app.getHttpServer())
      .post(`/ledgers/${ledger1Res.body.id}/expenses`)
      .set(auth(ownerToken))
      .send({
        items: [
          {
            amount: 50000,
            content: 'Invalid foreign category',
            categoryId: catFromLedger2,
          },
        ],
      })
      .expect(400);

    // Verify nothing inserted in ledger 1
    const listRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledger1Res.body.id}/expenses`)
      .set(auth(ownerToken))
      .expect(200);

    expect(listRes.body).toHaveLength(0);
  });

  it('only creator can edit or delete an expense; other members (even admin) get 403', async () => {
    const adminId = await createTestUser('admin');
    const adminToken = await mintToken(adminId);
    const memberId = await createTestUser('member');
    const memberToken = await mintToken(memberId);

    // Admin creates ledger
    const ledgerRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set(auth(adminToken))
      .send({ kind: 'family', name: 'Gia đình' })
      .expect(201);
    const ledgerId = ledgerRes.body.id;

    // Add member directly via DB for test simplicity
    await getPool().query(
      `INSERT INTO public.members (ledger_id, user_id, status) VALUES ($1, $2, 'active')`,
      [ledgerId, memberId],
    );

    // Member creates an expense
    const createRes = await request(app.getHttpServer())
      .post(`/ledgers/${ledgerId}/expenses`)
      .set(auth(memberToken))
      .send({
        items: [
          {
            amount: 30000,
            content: 'Mua trà sữa',
            spentAt: '2026-11-05T08:00:00Z',
          },
        ],
      })
      .expect(201);

    const expenseId = createRes.body[0].id;

    // Admin tries to update member's expense -> 403
    await request(app.getHttpServer())
      .patch(`/ledgers/${ledgerId}/expenses/${expenseId}`)
      .set(auth(adminToken))
      .send({ amount: 40000 })
      .expect(403);

    // Admin tries to delete member's expense -> 403
    await request(app.getHttpServer())
      .delete(`/ledgers/${ledgerId}/expenses/${expenseId}`)
      .set(auth(adminToken))
      .expect(403);

    // Member updates their own expense -> 200
    const updateRes = await request(app.getHttpServer())
      .patch(`/ledgers/${ledgerId}/expenses/${expenseId}`)
      .set(auth(memberToken))
      .send({ content: 'Mua trà sữa size L', amount: 35000 })
      .expect(200);

    expect(updateRes.body.content).toBe('Mua trà sữa size L');
    expect(updateRes.body.amount).toBe(35000);

    // Member deletes their own expense -> 200
    await request(app.getHttpServer())
      .delete(`/ledgers/${ledgerId}/expenses/${expenseId}`)
      .set(auth(memberToken))
      .expect(200);

    // Getting deleted expense -> 404
    await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/expenses/${expenseId}`)
      .set(auth(memberToken))
      .expect(404);
  });
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SignJWT } from 'jose';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { SupabaseService } from '../src/supabase/supabase.service';
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

describe('Reports & Attachments (e2e)', () => {
  let app: INestApplication;
  let supabaseService: SupabaseService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    supabaseService = app.get(SupabaseService);
    // Mock storage on supabaseService for e2e test
    jest.spyOn(supabaseService, 'client', 'get').mockReturnValue({
      storage: {
        from: () => ({
          createSignedUploadUrl: async (path: string) => ({
            data: { signedUrl: `https://mock.storage/upload/${path}` },
            error: null,
          }),
          createSignedUrl: async (path: string) => ({
            data: { signedUrl: `https://mock.storage/view/${path}` },
            error: null,
          }),
        }),
      },
    } as any);
  });

  afterAll(async () => {
    await resetDb();
    await getPool().end();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it('Review Focus: non-member or removed member gets 403 on report, upload-url, and image', async () => {
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

    // Report
    await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/reports/monthly?month=2026-11`)
      .set(auth(outsiderToken))
      .expect(403);

    // Upload URL
    await request(app.getHttpServer())
      .post(`/ledgers/${ledgerId}/attachments/upload-url`)
      .set(auth(outsiderToken))
      .send({ contentType: 'image/jpeg' })
      .expect(403);

    // Image view URL
    await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/expenses/00000000-0000-0000-0000-000000000000/image`)
      .set(auth(outsiderToken))
      .expect(403);
  });

  it('monthly report aggregates expenses and attachments generates upload/view URLs', async () => {
    const ownerId = await createTestUser('owner');
    const ownerToken = await mintToken(ownerId);

    const ledgerRes = await request(app.getHttpServer())
      .post('/ledgers')
      .set(auth(ownerToken))
      .send({ kind: 'family', name: 'Gia đình' })
      .expect(201);
    const ledgerId = ledgerRes.body.id;

    // Get categories
    const categoriesRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/categories`)
      .set(auth(ownerToken))
      .expect(200);
    const categoryId = categoriesRes.body[0].id;

    // Upload URL
    const uploadRes = await request(app.getHttpServer())
      .post(`/ledgers/${ledgerId}/attachments/upload-url`)
      .set(auth(ownerToken))
      .send({ contentType: 'image/jpeg' })
      .expect(201);
    expect(uploadRes.body.uploadUrl).toContain('https://mock.storage/upload');
    const imagePath = uploadRes.body.path;

    // Add expenses
    const createRes = await request(app.getHttpServer())
      .post(`/ledgers/${ledgerId}/expenses`)
      .set(auth(ownerToken))
      .send({
        items: [
          {
            amount: 50000,
            content: 'Phở',
            categoryId,
            imagePath,
            spentAt: '2026-11-05T08:00:00Z',
          },
          {
            amount: 25000,
            content: 'Cà phê',
            spentAt: '2026-11-05T09:00:00Z',
          },
        ],
      })
      .expect(201);
    const expenseWithImageId = createRes.body.find((e: any) => e.imagePath)?.id;

    // View image URL
    const viewRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/expenses/${expenseWithImageId}/image`)
      .set(auth(ownerToken))
      .expect(200);
    expect(viewRes.body.url).toContain('https://mock.storage/view');

    // Monthly report
    const reportRes = await request(app.getHttpServer())
      .get(`/ledgers/${ledgerId}/reports/monthly?month=2026-11`)
      .set(auth(ownerToken))
      .expect(200);

    expect(reportRes.body.total).toBe(75000);
    expect(reportRes.body.byCategory).toHaveLength(2); // 1 category + 1 uncategorised
    expect(reportRes.body.byMember).toHaveLength(1);
    expect(reportRes.body.byDay).toHaveLength(1);
    expect(reportRes.body.byDay[0].date).toBe('2026-11-05');
  });
});

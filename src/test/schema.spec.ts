import { getPool, resetDb, createTestUser } from './db';

describe('database schema', () => {
  afterAll(async () => {
    await resetDb();
    await getPool().end();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it('allows inserting a ledger, member, and expense', async () => {
    const db = getPool();
    const userId = await createTestUser('alice');

    const ledgerResult = await db.query<{ id: string }>(
      `insert into public.ledgers (kind, name, admin_id) values ('family', 'Home', $1) returning id`,
      [userId],
    );
    const ledgerId = ledgerResult.rows[0].id;

    await db.query(
      `insert into public.members (ledger_id, user_id, status) values ($1, $2, 'active')`,
      [ledgerId, userId],
    );

    const expenseResult = await db.query<{ id: string }>(
      `insert into public.expenses (ledger_id, created_by, amount, content, spent_at)
       values ($1, $2, 1000, 'Groceries', now()) returning id`,
      [ledgerId, userId],
    );

    expect(expenseResult.rows[0].id).toBeDefined();
  });

  it('rejects a non-positive expense amount', async () => {
    const db = getPool();
    const userId = await createTestUser('bob');
    const ledgerResult = await db.query<{ id: string }>(
      `insert into public.ledgers (kind, name, admin_id) values ('family', 'Home', $1) returning id`,
      [userId],
    );
    const ledgerId = ledgerResult.rows[0].id;

    await expect(
      db.query(
        `insert into public.expenses (ledger_id, created_by, amount, content, spent_at)
         values ($1, $2, 0, 'Invalid', now())`,
        [ledgerId, userId],
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate budget key', async () => {
    const db = getPool();
    const userId = await createTestUser('carol');
    const ledgerResult = await db.query<{ id: string }>(
      `insert into public.ledgers (kind, name, admin_id) values ('family', 'Home', $1) returning id`,
      [userId],
    );
    const ledgerId = ledgerResult.rows[0].id;

    await db.query(
      `insert into public.budgets (ledger_id, member_user_id, category_id, month, amount)
       values ($1, null, null, '2026-11-01', 500000)`,
      [ledgerId],
    );

    await expect(
      db.query(
        `insert into public.budgets (ledger_id, member_user_id, category_id, month, amount)
         values ($1, null, null, '2026-11-01', 999999)`,
        [ledgerId],
      ),
    ).rejects.toThrow();
  });
});

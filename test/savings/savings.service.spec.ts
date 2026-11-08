import { BadRequestException } from '@nestjs/common';
import { SavingsService } from '../../src/savings/savings.service';
import { SupabaseService } from '../../src/supabase/supabase.service';

describe('SavingsService', () => {
  const query = jest.fn();
  const release = jest.fn();
  const client = { query, release };
  const db = { query, connect: jest.fn().mockResolvedValue(client) };
  let service: SavingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue({ rows: [] });
    service = new SavingsService({ db } as unknown as SupabaseService);
  });

  it('only lists goals owned by the authenticated user', async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: 'goal-1',
          name: 'Dự phòng',
          target: '1000000',
          balance: '200000',
          due_date: null,
        },
      ],
    });
    await expect(service.list('owner-1')).resolves.toEqual([
      {
        id: 'goal-1',
        name: 'Dự phòng',
        target: 1000000,
        balance: 200000,
        dueDate: null,
      },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('user_id = $1'),
      ['owner-1'],
    );
  });

  it('rejects withdrawal beyond the locked current balance', async () => {
    query.mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.includes('FOR UPDATE') ? [{ balance: '200000' }] : [],
      }),
    );
    await expect(
      service.addEntry('owner-1', 'goal-1', {
        type: 'withdrawal',
        amount: 300000,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.savings_entries'),
      expect.anything(),
    );
  });

  it('records a deposit and updates its goal in a transaction', async () => {
    query.mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.includes('FOR UPDATE') ? [{ balance: '200000' }] : [],
      }),
    );
    await service.addEntry('owner-1', 'goal-1', {
      type: 'deposit',
      amount: 100000,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), [
      'goal-1',
      'owner-1',
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE public.savings_goals'),
      [100000, 'goal-1', 'owner-1'],
    );
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalled();
  });
});

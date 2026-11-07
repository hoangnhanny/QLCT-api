import { mapExpense, ExpenseRow } from '../../src/expenses/expenses.types';

describe('mapExpense', () => {
  it('maps a raw joined SQL row into ExpenseResponse with parsed number amount', () => {
    const spentAtDate = new Date('2026-11-05T05:00:00Z');
    const createdAtDate = new Date('2026-11-05T05:01:00Z');
    const rawRow: ExpenseRow = {
      id: 'e1',
      ledger_id: 'l1',
      created_by: 'u1',
      amount: '50000',
      content: 'Lunch Pho',
      category_id: 'c1',
      image_path: 'receipts/pho.jpg',
      spent_at: spentAtDate,
      created_at: createdAtDate,
      category_name: 'Food',
      category_icon: 'pho',
      creator_display_name: 'Nguyen Van A',
      creator_avatar_url: 'https://example.com/avatar.png',
    };

    const result = mapExpense(rawRow);
    expect(result).toEqual({
      type: 'expense',
      id: 'e1',
      ledgerId: 'l1',
      createdBy: 'u1',
      amount: 50000,
      content: 'Lunch Pho',
      categoryId: 'c1',
      spentAt: spentAtDate,
      createdAt: createdAtDate,
      imagePath: 'receipts/pho.jpg',
      category: {
        id: 'c1',
        name: 'Food',
        icon: 'pho',
      },
      creator: {
        id: 'u1',
        displayName: 'Nguyen Van A',
        avatarUrl: 'https://example.com/avatar.png',
      },
    });
  });

  it('handles null category, image, and profile gracefully', () => {
    const rawRow: ExpenseRow = {
      id: 'e2',
      ledger_id: 'l1',
      created_by: 'u1',
      amount: 20000,
      content: 'Coffee',
      category_id: null,
      image_path: null,
      spent_at: '2026-11-05T06:00:00.000Z',
      created_at: '2026-11-05T06:00:00.000Z',
      category_name: null,
      category_icon: null,
      creator_display_name: null,
      creator_avatar_url: null,
    };

    const result = mapExpense(rawRow);
    expect(result.amount).toBe(20000);
    expect(result.category).toBeNull();
    expect(result.imagePath).toBeNull();
    expect(result.creator?.displayName).toBeNull();
    expect(result.creator?.avatarUrl).toBeNull();
  });
});

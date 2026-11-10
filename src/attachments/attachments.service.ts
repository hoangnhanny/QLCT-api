import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { SupabaseService } from '../supabase/supabase.service';
import { Expense as ExpenseEntity } from '../database/entities/expense.entity';

@Injectable()
export class AttachmentsService {
  private readonly legacyDb?: {
    query: (sql: string, params?: any[]) => Promise<any>;
  };
  private readonly expenseRepo?: Repository<ExpenseEntity>;

  constructor(
    private readonly supabase: SupabaseService,
    @InjectRepository(ExpenseEntity)
    @Optional()
    expenseRepo?: Repository<ExpenseEntity>,
  ) {
    if ((supabase as any)?.db) {
      this.legacyDb = (supabase as any).db;
    }
    this.expenseRepo = expenseRepo;
  }

  async createUploadUrl(
    ledgerId: string,
    userId: string,
    contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  ): Promise<{ path: string; uploadUrl: string }> {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(contentType)) {
      throw new BadRequestException(
        `Invalid content type "${contentType}". Allowed: image/jpeg, image/png, image/webp`,
      );
    }

    const ext =
      contentType === 'image/jpeg'
        ? 'jpg'
        : contentType === 'image/png'
          ? 'png'
          : 'webp';

    const filename = `${randomUUID()}.${ext}`;
    const path = `${ledgerId}/${filename}`;

    const { data, error } = await this.supabase.client.storage
      .from('receipts')
      .createSignedUploadUrl(path);

    if (error || !data) {
      throw new BadRequestException(
        `Failed to create upload URL: ${error?.message ?? 'unknown error'}`,
      );
    }

    return { path, uploadUrl: data.signedUrl };
  }

  async createViewUrl(
    ledgerId: string,
    expenseId: string,
  ): Promise<{ url: string }> {
    let imagePath: string | null = null;

    if (this.legacyDb && !this.expenseRepo) {
      const res = await this.legacyDb.query(
        `SELECT image_path FROM public.expenses WHERE id = $1 AND ledger_id = $2`,
        [expenseId, ledgerId],
      );
      const expense = res.rows[0];
      if (!expense) {
        throw new NotFoundException('Expense not found');
      }
      imagePath = expense.image_path;
    } else {
      const expense = await this.expenseRepo!.findOne({
        where: { id: expenseId, ledgerId },
        select: { imagePath: true },
      });
      if (!expense) {
        throw new NotFoundException('Expense not found');
      }
      imagePath = expense.imagePath;
    }

    if (!imagePath) {
      throw new NotFoundException('Expense has no image attachment');
    }

    const { data, error } = await this.supabase.client.storage
      .from('receipts')
      .createSignedUrl(imagePath, 300);

    if (error || !data) {
      throw new BadRequestException(
        `Failed to create view URL: ${error?.message ?? 'unknown error'}`,
      );
    }

    return { url: data.signedUrl };
  }
}

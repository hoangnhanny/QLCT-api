import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AttachmentsService {
  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.db;
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
    const res = await this.db.query<{ image_path: string | null }>(
      `SELECT image_path FROM public.expenses WHERE id = $1 AND ledger_id = $2`,
      [expenseId, ledgerId],
    );

    const expense = res.rows[0];
    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    if (!expense.image_path) {
      throw new NotFoundException('Expense has no image attachment');
    }

    const { data, error } = await this.supabase.client.storage
      .from('receipts')
      .createSignedUrl(expense.image_path, 300);

    if (error || !data) {
      throw new BadRequestException(
        `Failed to create view URL: ${error?.message ?? 'unknown error'}`,
      );
    }

    return { url: data.signedUrl };
  }
}

import { IsIn, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

export class ListExpensesDto {
  @IsOptional()
  @IsIn(['expense', 'income'])
  type?: 'expense' | 'income';

  @IsOptional()
  @Matches(/^(\d{4}-\d{2})(-\d{2})?$/, {
    message: 'month must be in YYYY-MM or YYYY-MM-01 format',
  })
  month?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

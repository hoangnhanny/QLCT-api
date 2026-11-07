import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

export class ListExpensesQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'month must be formatted as YYYY-MM (e.g. 2026-11)',
  })
  month?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

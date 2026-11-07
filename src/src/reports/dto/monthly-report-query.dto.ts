import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class MonthlyReportQueryDto {
  @IsNotEmpty()
  @IsString()
  month: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class RangeReportQueryDto {
  @IsNotEmpty()
  @IsString()
  from: string;

  @IsNotEmpty()
  @IsString()
  to: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['day', 'week', 'month'])
  groupBy: 'day' | 'week' | 'month';
}

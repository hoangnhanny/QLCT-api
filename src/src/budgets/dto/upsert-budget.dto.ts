import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class UpsertBudgetDto {
  @IsOptional()
  @IsUUID()
  memberUserId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsNotEmpty()
  @IsString()
  month: string;

  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  amount: number;
}

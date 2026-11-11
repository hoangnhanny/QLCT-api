import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateExpenseItemDto {
  @IsOptional()
  @IsIn(['expense', 'income'])
  type?: 'expense' | 'income';

  @IsOptional()
  @IsIn(['cash', 'transfer'])
  paymentMethod?: 'cash' | 'transfer';

  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  content: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  imagePath?: string;

  @IsOptional()
  @IsISO8601()
  spentAt?: string;
}

export class CreateExpenseBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateExpenseItemDto)
  items: CreateExpenseItemDto[];
}

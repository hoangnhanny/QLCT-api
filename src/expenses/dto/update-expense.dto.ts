import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateExpenseDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  content?: string;

  @IsOptional()
  @IsISO8601()
  spentAt?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  imagePath?: string | null;
}

import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSavingsGoalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  target: number;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}

export class CreateSavingsEntryDto {
  @IsIn(['deposit', 'withdrawal'])
  type: 'deposit' | 'withdrawal';

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

import { IsNotEmpty, IsString } from 'class-validator';

export class ListBudgetsQueryDto {
  @IsNotEmpty()
  @IsString()
  month: string;
}

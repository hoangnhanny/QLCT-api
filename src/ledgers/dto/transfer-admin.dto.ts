import { IsUUID } from 'class-validator';

export class TransferAdminDto {
  @IsUUID()
  userId: string;
}

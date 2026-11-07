import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class CreateUploadUrlDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

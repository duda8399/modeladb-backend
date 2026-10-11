import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class RenameVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string | null;
}

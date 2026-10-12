import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DuplicateDiagramDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

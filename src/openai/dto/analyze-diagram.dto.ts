import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class AnalyzeDiagramDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  diagramName?: string;

  @IsOptional()
  @IsArray()
  nodes?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  edges?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  focus?: string;
}

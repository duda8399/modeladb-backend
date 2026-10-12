import { ArrayMaxSize, IsArray, IsMongoId, IsOptional } from 'class-validator';

export class MarkInvitationsSeenDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  diagramIds?: string[];
}

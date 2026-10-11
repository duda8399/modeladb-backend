import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Request,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { DiagramVersionService } from './diagram-version.service';
import { CreateVersionDto, RenameVersionDto } from './dto/version.dto';

type AuthRequest = { user?: { sub?: string } };

@UseGuards(JwtAuthGuard)
@Controller('diagram/:id/versions')
export class DiagramVersionController {
  constructor(private versionService: DiagramVersionService) {}

  @Get()
  list(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.run(req, 'Não foi possível buscar o histórico', (userId) =>
      this.versionService.list(id, userId),
    );
  }

  @Get(':versionId')
  get(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Request() req: AuthRequest,
  ) {
    return this.run(req, 'Não foi possível buscar a versão', (userId) =>
      this.versionService.get(id, versionId, userId),
    );
  }

  @Post()
  create(
    @Param('id') id: string,
    @Body() dto: CreateVersionDto,
    @Request() req: AuthRequest,
  ) {
    return this.run(req, 'Não foi possível salvar a versão', (userId) =>
      this.versionService.create(id, userId, dto?.label),
    );
  }

  @Patch(':versionId')
  rename(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() dto: RenameVersionDto,
    @Request() req: AuthRequest,
  ) {
    return this.run(req, 'Não foi possível renomear a versão', (userId) =>
      this.versionService.rename(id, versionId, userId, dto?.label),
    );
  }

  @Post(':versionId/restore')
  restore(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Request() req: AuthRequest,
  ) {
    return this.run(req, 'Não foi possível restaurar a versão', (userId) =>
      this.versionService.restore(id, versionId, userId),
    );
  }

  @Delete(':versionId')
  remove(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Request() req: AuthRequest,
  ) {
    return this.run(req, 'Não foi possível excluir a versão', (userId) =>
      this.versionService.remove(id, versionId, userId),
    );
  }

  private async run<T>(
    req: AuthRequest,
    fallback: string,
    action: (userId: string) => Promise<T>,
  ) {
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException('Usuário não autenticado');

    try {
      return await action(userId);
    } catch (error) {
      const status =
        error instanceof ForbiddenException
          ? HttpStatus.FORBIDDEN
          : error instanceof NotFoundException
            ? HttpStatus.NOT_FOUND
            : HttpStatus.BAD_REQUEST;
      throw new HttpException((error as Error)?.message || fallback, status);
    }
  }
}

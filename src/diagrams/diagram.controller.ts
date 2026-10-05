import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
  Body,
  Post,
  Put,
  Patch,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  UnauthorizedException,
  ForbiddenException,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DiagramDto } from './dto/diagram.dto';
import { DiagramService } from './diagram.service';
import { UpdateDiagramDto } from './dto/update-diagram.dto';
import { AddCollaboratorDto } from './dto/add-collaborator.dto';
import { UpdateCollaboratorRoleDto } from './dto/update-collaborator-role.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@Controller('diagram')
export class DiagramController {
  constructor(private diagramService: DiagramService) {}

  @UseGuards(JwtAuthGuard)
  @Get('my-documents')
  async getMyDocuments(@Request() req: { user?: { sub?: string } }) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.findByUserId(userId);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível buscar os documentos',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('recent')
  async getRecentDocuments(@Request() req: { user?: { sub?: string } }) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.findRecentByUserId(userId);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível buscar os documentos recentes',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('shared-with-me')
  async getSharedWithMe(@Request() req: { user?: { sub?: string } }) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.findSharedWithUser(userId);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível buscar os diagramas compartilhados',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findDiagram(
    @Param('id') id: string,
    @Request() req: { user?: { sub?: string } },
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.findByIdForUser(id, userId);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Diagrama não encontrado',
        error instanceof ForbiddenException
          ? HttpStatus.FORBIDDEN
          : HttpStatus.NOT_FOUND,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('/create')
  async create(
    @Body() dto: DiagramDto,
    @Request() req: { user?: { sub?: string } },
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.create(dto, userId);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível criar o diagrama',
        error instanceof UnauthorizedException
          ? HttpStatus.UNAUTHORIZED
          : HttpStatus.NOT_FOUND,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDiagramDto,
    @Request() req: { user?: { sub?: string } },
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.update(id, dto, userId);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Nao foi possivel atualizar o diagrama',
        error instanceof ForbiddenException
          ? HttpStatus.FORBIDDEN
          : HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/thumbnail')
  @UseInterceptors(
    FileInterceptor('thumbnail', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async updateThumbnail(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: { user?: { sub?: string } },
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.updateThumbnail(id, file, userId);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível salvar o print do diagrama',
        error instanceof ForbiddenException
          ? HttpStatus.FORBIDDEN
          : HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/collaborators')
  async addCollaborator(
    @Param('id') id: string,
    @Body() dto: AddCollaboratorDto,
    @Request() req: { user?: { sub?: string } },
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.addCollaborator(id, userId, dto);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível adicionar o colaborador',
        error instanceof ForbiddenException
          ? HttpStatus.FORBIDDEN
          : HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/collaborators')
  async listCollaborators(
    @Param('id') id: string,
    @Request() req: { user?: { sub?: string } },
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.listCollaborators(id, userId);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível buscar os colaboradores',
        error instanceof ForbiddenException
          ? HttpStatus.FORBIDDEN
          : HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/collaborators/:userId')
  async updateCollaboratorRole(
    @Param('id') id: string,
    @Param('userId') collaboratorUserId: string,
    @Body() dto: UpdateCollaboratorRoleDto,
    @Request() req: { user?: { sub?: string } },
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.updateCollaboratorRole(
        id,
        userId,
        collaboratorUserId,
        dto,
      );
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível atualizar a permissão',
        error instanceof ForbiddenException
          ? HttpStatus.FORBIDDEN
          : HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/collaborators/:userId')
  async removeCollaborator(
    @Param('id') id: string,
    @Param('userId') collaboratorUserId: string,
    @Request() req: { user?: { sub?: string } },
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.removeCollaborator(
        id,
        userId,
        collaboratorUserId,
      );
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível remover o colaborador',
        error instanceof ForbiddenException
          ? HttpStatus.FORBIDDEN
          : HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteDiagram(
    @Param('id') id: string,
    @Request() req: { user?: { sub?: string } },
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.diagramService.deleteByIdForUser(id, userId);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível remover o documento',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

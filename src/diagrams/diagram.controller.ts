import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
  Body,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  UnauthorizedException,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { DiagramDto } from './dto/diagram.dto';
import { DiagramService } from './diagram.service';
import { UpdateDiagramDto } from './dto/update-diagram.dto';
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

  @Get(':id')
  async findDiagram(@Param('id') id: string) {
    try {
      return await this.diagramService.findById(id);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Diagrama não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Post('/create')
  async create(@Body() dto: DiagramDto) {
    try {
      return await this.diagramService.create(dto);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível criar o diagrama',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDiagramDto) {
    try {
      return await this.diagramService.update(id, dto);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Nao foi possivel atualizar o diagrama',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Put(':id/thumbnail')
  @UseInterceptors(
    FileInterceptor('thumbnail', {
      storage: diskStorage({
        destination: join(process.cwd(), 'storage', 'diagrams'),
        filename: (req, file, cb) => {
          cb(null, `${req.params.id}${extname(file.originalname) || '.jpg'}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async updateThumbnail(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    try {
      return await this.diagramService.updateThumbnail(id, file);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível salvar o print do diagrama',
        HttpStatus.BAD_REQUEST,
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

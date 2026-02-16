import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
  Body,
  Post,
} from '@nestjs/common';
import { DiagramDto } from './dto/diagram.dto';
import { DiagramService } from './diagram.service';

@Controller('diagram')
export class DiagramController {
  constructor(private diagramService: DiagramService) {}

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
  async create(@Body('') dto: DiagramDto) {
    try {
      return await this.diagramService.create(dto);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível criar o diagrama',
        HttpStatus.NOT_FOUND,
      );
    }
  }
}

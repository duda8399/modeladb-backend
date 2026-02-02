import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Db, MongoClient } from 'mongodb';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private db: Db;

  async onModuleInit() {
    await this.$connect();

    const mongoClient = new MongoClient(process.env.DATABASE_URL as string);
    await mongoClient.connect();
    this.db = mongoClient.db();
  }

  async onApplicationShutdown() {
    await this.$disconnect();
  }
}

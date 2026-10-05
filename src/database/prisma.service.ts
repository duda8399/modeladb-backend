import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Db, MongoClient } from 'mongodb';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private mongoClient: MongoClient;
  private db: Db;

  async onModuleInit() {
    await this.$connect();

    this.mongoClient = new MongoClient(process.env.DATABASE_URL as string);
    await this.mongoClient.connect();
    this.db = this.mongoClient.db();
  }

  async onApplicationShutdown() {
    await this.mongoClient?.close();
    await this.$disconnect();
  }
}

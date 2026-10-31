import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { RabbitMqModule } from '../rabbitmq/rabbitmq-connection.module';
import { OutboxPublisherService } from './outbox-publisher.service';

@Module({
  imports: [PrismaModule, RabbitMqModule],
  providers: [OutboxPublisherService],
  exports: [OutboxPublisherService],
})
export class OutboxModule {}

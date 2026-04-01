import { prisma } from '../../config/prisma.js';

export async function createNotification(userId: string, title: string, message: string, type: string) {
  return prisma.notification.create({ data: { userId, title, message, type } });
}

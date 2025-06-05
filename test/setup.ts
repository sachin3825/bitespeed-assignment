import { beforeEach, after } from 'node:test';
import { prisma } from '../src/lib/prisma';

beforeEach(async () => {
  await prisma.contact.deleteMany({});
});

after(async () => {
  await prisma.$disconnect();
});

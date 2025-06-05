import request from 'supertest';
import app from '../src/app';
import {prisma} from '../src/lib/prisma';

beforeEach(async () => {
  await prisma.contact.deleteMany(); // Clean slate for each test
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('/api/identify endpoint', () => {
  test('1️⃣ New contact with only email', async () => {
    const res = await request(app).post('/api/identify').send({ email: 'solo@example.com' });

    expect(res.statusCode).toBe(200);
    expect(res.body.contact.emails).toContain('solo@example.com');
    expect(res.body.contact.phoneNumbers).toHaveLength(0);
  });

  test('2️⃣ New contact with only phoneNumber', async () => {
    const res = await request(app).post('/api/identify').send({ phoneNumber: '9876543210' });

    expect(res.statusCode).toBe(200);
    expect(res.body.contact.phoneNumbers).toContain('9876543210');
    expect(res.body.contact.emails).toHaveLength(0);
  });

  test('3️⃣ New contact with both new email and phoneNumber', async () => {
    const res = await request(app).post('/api/identify').send({
      email: 'fresh@combo.com',
      phoneNumber: '1231231234'
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.contact.emails).toContain('fresh@combo.com');
    expect(res.body.contact.phoneNumbers).toContain('1231231234');
  });

  test('4️⃣ Existing email match', async () => {
    await prisma.contact.create({
      data: {
        email: 'repeat@example.com',
        phoneNumber: '9999999999',
        linkPrecedence: 'PRIMARY',
      },
    });

    const res = await request(app).post('/api/identify').send({ email: 'repeat@example.com' });

    expect(res.statusCode).toBe(200);
    expect(res.body.contact.emails).toContain('repeat@example.com');
  });

test('5️⃣ Matching phone, new email → creates secondary', async () => {
  // Step 1: Create initial contact with phone only
  const initialRes = await request(app)
    .post('/identify')
    .send({ phoneNumber: '1234567890' });
  expect(initialRes.statusCode).toBe(200);
  const primaryId = initialRes.body.contact.primaryContactId;

  // Step 2: Send identify with same phone + new email
  const newRes = await request(app)
    .post('/identify')
    .send({ phoneNumber: '1234567890', email: 'newemail@example.com' });
  expect(newRes.statusCode).toBe(200);

  const contact = newRes.body.contact;

  // Primary contactId must remain the same
  expect(contact.primaryContactId).toBe(primaryId);

  // New email should be in emails list
  expect(contact.emails).toContain('newemail@example.com');

  // There should be at least one secondary contact ID
  expect(contact.secondaryContactIds.length).toBeGreaterThan(0);
});


test('Merge two primaries', async () => {
  // Create first primary
  const first = await prisma.contact.create({
    data: { email: 'first@merge.com', linkPrecedence: 'PRIMARY' },
  });

  // Create second primary
  const second = await prisma.contact.create({
    data: { email: 'second@merge.com', linkPrecedence: 'PRIMARY' },
  });

  // Call identify with email from second and phone of first (or vice versa)
  const res = await request(app)
    .post('/identify')
    .send({ email: 'first@merge.com', phoneNumber: null });

  expect(res.statusCode).toBe(200);

  // Oldest primary should remain primary
  expect(res.body.contact.primaryContactId).toBe(first.id);

  // Both emails should be present in the response
  expect(res.body.contact.emails).toEqual(expect.arrayContaining(['first@merge.com', 'second@merge.com']));

  // SecondaryContactIds should include the merged contact's ID
  expect(res.body.contact.secondaryContactIds).toContain(second.id);
});


  test('7️⃣ Missing both email and phoneNumber — returns 400', async () => {
    const res = await request(app).post('/api/identify').send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

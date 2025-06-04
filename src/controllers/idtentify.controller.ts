import express from 'express';
import { prisma } from '../lib/prisma';

const router = express.Router();

// Create a new contact
router.post('/test-create', async (req, res) => {
  try {
    const contact = await prisma.contact.create({
      data: {
        email: req.body.email || null,
        phoneNumber: req.body.phoneNumber || null,
      },
    });

    res.status(201).json({ contact });
  } catch (error) {
    console.error('Error creating contact:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get all contacts
router.get('/test-contacts', async (_req, res) => {
  try {
    const contacts = await prisma.contact.findMany();
    res.status(200).json({ contacts });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;

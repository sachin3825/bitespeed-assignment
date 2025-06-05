import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { LinkPrecedence, Contact } from '../generated/prisma/client';
import { z } from 'zod';

export interface ContactResponse {
  contact: {
    primaryContactId: number;
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
  };
}

export const identifyRequestSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email({ message: 'Email must be valid.' })
      .optional()
      .or(z.literal('').transform(() => undefined)),

    phoneNumber: z
      .string()
      .trim()
      .regex(/^\d{4,15}$/, {
        message: 'Phone number must be 4–15 digits long, digits only.',
      })
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .refine((data) => data.email || data.phoneNumber, {
    message: 'Provide at least one of email or phoneNumber.',
  });

export const identifyController = async (req: Request, res: any): Promise<void> => {
  try {
    const parsedResult = identifyRequestSchema.safeParse(req.body);

    if (!parsedResult.success) {
      return res.status(400).json({
        error: 'Invalid request data',
        message: parsedResult.error.errors.map((err) => err.message).join(', '),
      });
    }

    const { email, phoneNumber } = parsedResult.data;

    // Step 1: Fetch existing contacts with matching email or phone number
    const matchingContacts = await prisma.contact.findMany({
      where: {
        OR: [{ email: email ?? undefined }, { phoneNumber: phoneNumber ?? undefined }],
      },
      orderBy: { createdAt: 'asc' },
    });

    // Step 2: If no match found, create a new PRIMARY contact
    if (matchingContacts.length === 0) {
      const newContact = await prisma.contact.create({
        data: {
          email: email ?? null,
          phoneNumber: phoneNumber ?? null,
          linkPrecedence: LinkPrecedence.PRIMARY,
        },
      });

      const response: ContactResponse = {
        contact: {
          primaryContactId: newContact.id,
          emails: newContact.email ? [newContact.email] : [],
          phoneNumbers: newContact.phoneNumber ? [newContact.phoneNumber] : [],
          secondaryContactIds: [],
        },
      };

      return res.status(200).json(response);
    }

    // Step 3: Collect all related contacts (both primary and secondary)
    const relatedContactIds = new Set<number>();
    const toProcess = [...matchingContacts];

    while (toProcess.length > 0) {
      const current = toProcess.pop();
      if (!current || relatedContactIds.has(current.id)) continue;

      relatedContactIds.add(current.id);

      if (current.linkPrecedence === LinkPrecedence.PRIMARY) {
        const secondaries = await prisma.contact.findMany({
          where: {
            linkedId: current.id,
            deletedAt: null,
          },
        });
        toProcess.push(...secondaries);
      } else if (current.linkedId) {
        const primary = await prisma.contact.findUnique({
          where: {
            id: current.linkedId,
          },
        });

        if (primary && !relatedContactIds.has(primary.id)) {
          toProcess.push(primary);
        }

        const siblingSecondaries = await prisma.contact.findMany({
          where: {
            linkedId: current.linkedId,
            deletedAt: null,
          },
        });

        toProcess.push(...siblingSecondaries.filter((c: Contact) => !relatedContactIds.has(c.id)));
      }
    }

    // Step 4: Fetch all related contacts using collected IDs
    let allContacts = await prisma.contact.findMany({
      where: {
        id: { in: Array.from(relatedContactIds) },
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Step 5: If no exact match exists, create a secondary contact
    const hasExactMatch = allContacts.some(
      (c: Contact) => c.email === email || c.phoneNumber === phoneNumber,
    );

    if (!hasExactMatch) {
      const isNewEmail = email && !allContacts.some((c: Contact) => c.email === email);
      const isNewPhone =
        phoneNumber && !allContacts.some((c: Contact) => c.phoneNumber === phoneNumber);

      if (isNewEmail || isNewPhone) {
        const primaryContact =
          allContacts.find((c: Contact) => c.linkPrecedence === LinkPrecedence.PRIMARY) ??
          allContacts[0];

        const newSecondary = await prisma.contact.create({
          data: {
            email: email ?? null,
            phoneNumber: phoneNumber ?? null,
            linkedId: primaryContact.id,
            linkPrecedence: LinkPrecedence.SECONDARY,
          },
        });

        allContacts.push(newSecondary);
      }
    }

    // Step 6: Resolve multiple primaries (if exist) by demoting all but the oldest
    const primaryContacts = allContacts.filter(
      (c: Contact) => c.linkPrecedence === LinkPrecedence.PRIMARY,
    );

    if (primaryContacts.length > 1) {
      const oldestPrimary = primaryContacts.reduce((oldest: Contact, current: Contact) =>
        current.createdAt < oldest.createdAt ? current : oldest,
      );

      const toBeUpdated = primaryContacts.filter((c: Contact) => c.id !== oldestPrimary.id);

      for (const contact of toBeUpdated) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: {
            linkPrecedence: LinkPrecedence.SECONDARY,
            linkedId: oldestPrimary.id,
            updatedAt: new Date(),
          },
        });

        await prisma.contact.updateMany({
          where: { linkedId: contact.id },
          data: { linkedId: oldestPrimary.id },
        });
      }

      allContacts = await prisma.contact.findMany({
        where: {
          OR: [{ id: oldestPrimary.id }, { linkedId: oldestPrimary.id }],
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    // Step 7: Format and return the final response
    const finalPrimary = allContacts.find(
      (c: Contact) => c.linkPrecedence === LinkPrecedence.PRIMARY,
    ) as Contact;

    const finalSecondaries = allContacts.filter(
      (c: Contact) => c.linkPrecedence === LinkPrecedence.SECONDARY,
    );

    const uniqueEmails = Array.from(
      new Set(
        [finalPrimary.email, ...finalSecondaries.map((c: Contact) => c.email)].filter(Boolean),
      ),
    ) as string[];

    const uniquePhoneNumbers = Array.from(
      new Set(
        [finalPrimary.phoneNumber, ...finalSecondaries.map((c: Contact) => c.phoneNumber)].filter(
          Boolean,
        ),
      ),
    ) as string[];

    const response: ContactResponse = {
      contact: {
        primaryContactId: finalPrimary.id,
        emails: uniqueEmails,
        phoneNumbers: uniquePhoneNumbers,
        secondaryContactIds: finalSecondaries.map((c: Contact) => c.id),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error in identifyController:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

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
      .or(z.literal('').transform(() => undefined))
      .refine((email) => {
        if (!email) return true;
        const validEmailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return validEmailRegex.test(email);
      }, { message: 'Email contains invalid characters.' }),

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
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({
        error: 'Invalid request data',
        message: 'Request body must be a valid object.',
      });
    }

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
        OR: [
          ...(email ? [{ email }] : []),
          ...(phoneNumber ? [{ phoneNumber }] : [])
        ],
        deletedAt: null,
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

    // Step 3: Collect all related contacts using BFS to avoid infinite loops
    const relatedContactIds = new Set<number>();
    const visited = new Set<number>();
    const queue = [...matchingContacts];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.id)) continue;

      visited.add(current.id);
      relatedContactIds.add(current.id);

      if (current.linkPrecedence === LinkPrecedence.PRIMARY) {
        const secondaries = await prisma.contact.findMany({
          where: {
            linkedId: current.id,
            deletedAt: null,
          },
        });
        queue.push(...secondaries.filter( (c: Contact) => !visited.has(c.id)));
              } else if (current.linkedId && !visited.has(current.linkedId)) {
        try {
          const primary = await prisma.contact.findUnique({
            where: {
              id: current.linkedId,
              deletedAt: null,
            },
          });

          if (primary) {
            queue.push(primary);
            const siblingSecondaries = await prisma.contact.findMany({
              where: {
                linkedId: current.linkedId,
                deletedAt: null,
              },
            });
            queue.push(...siblingSecondaries.filter((c : Contact) => !visited.has(c.id)));
          } else {
            console.warn(`Contact ${current.id} has linkedId ${current.linkedId} pointing to non-existent contact`);
          }
        } catch (error) {
          console.error(`Error fetching linked contact for ${current.id}:`, error);
        }
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

    // Step 5: Check if we need to create a new secondary contact
    const existingEmails = new Set(allContacts.map((c : Contact) => c.email).filter(Boolean));
    const existingPhones = new Set(allContacts.map((c : Contact) => c.phoneNumber).filter(Boolean));
    
    const hasNewEmail = email && !existingEmails.has(email);
    const hasNewPhone = phoneNumber && !existingPhones.has(phoneNumber);
    
    // Create secondary contact if we have new information not present in existing contacts
    if (hasNewEmail || hasNewPhone) {
      let primaryContact = allContacts.find((c: Contact) => c.linkPrecedence === LinkPrecedence.PRIMARY);
      if (!primaryContact && allContacts.length > 0) {
        primaryContact = allContacts[0];
        if (primaryContact.linkPrecedence === LinkPrecedence.SECONDARY) {
          await prisma.contact.update({
            where: { id: primaryContact.id },
            data: {
              linkPrecedence: LinkPrecedence.PRIMARY,
              linkedId: null,
              updatedAt: new Date(),
            },
          });
          primaryContact.linkPrecedence = LinkPrecedence.PRIMARY;
          primaryContact.linkedId = null;
        }
      }

      if (primaryContact) {
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

    // Step 6: Resolve multiple primaries by promoting the oldest and demoting others
    const primaryContacts = allContacts.filter(
      (c: Contact) => c.linkPrecedence === LinkPrecedence.PRIMARY,
    );

    if (primaryContacts.length > 1) {
      const oldestPrimary = primaryContacts.reduce((oldest: Contact, current: Contact) => {
        const oldestDate = new Date(oldest.createdAt).getTime();
        const currentDate = new Date(current.createdAt).getTime();
        return currentDate < oldestDate ? current : oldest;
      });

      const primariesToDemote = primaryContacts.filter((c: Contact) => c.id !== oldestPrimary.id);

      for (const contact of primariesToDemote) {
        try {
          await prisma.contact.update({
            where: { id: contact.id },
            data: {
              linkPrecedence: LinkPrecedence.SECONDARY,
              linkedId: oldestPrimary.id,
              updatedAt: new Date(),
            },
          });

          await prisma.contact.updateMany({
            where: { 
              linkedId: contact.id,
              deletedAt: null,
            },
            data: { linkedId: oldestPrimary.id },
          });
        } catch (updateError) {
          console.error(`Failed to update contact ${contact.id}:`, updateError);
        }
      }

      allContacts = await prisma.contact.findMany({
        where: {
          OR: [
            { id: oldestPrimary.id },
            { linkedId: oldestPrimary.id }
          ],
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    // Step 7: Format and return the final response
    const finalPrimary = allContacts.find(
      (c: Contact) => c.linkPrecedence === LinkPrecedence.PRIMARY,
    );

    if (!finalPrimary) {
      throw new Error('No primary contact found after processing');
    }

    const finalSecondaries = allContacts.filter(
      (c: Contact) => c.linkPrecedence === LinkPrecedence.SECONDARY,
    );

    const allEmails = [finalPrimary.email, ...finalSecondaries.map((c: Contact) => c.email)]
      .filter((email): email is string => Boolean(email));
    const uniqueEmails = Array.from(new Set(allEmails));

    const allPhoneNumbers = [finalPrimary.phoneNumber, ...finalSecondaries.map((c: Contact) => c.phoneNumber)]
      .filter((phone): phone is string => Boolean(phone));
    const uniquePhoneNumbers = Array.from(new Set(allPhoneNumbers));

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
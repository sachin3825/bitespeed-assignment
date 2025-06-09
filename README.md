
# Bitespeed Assignment

[Live Demo](https://bitespeed-assignment-w8o9.onrender.com/)

---

## Project Overview

This project implements a customer identity consolidation service for Bitespeed. It tracks and links customer contacts based on shared email or phone numbers using a PostgreSQL database and Prisma ORM. The backend is built with Node.js, Express, and TypeScript.

The service exposes a `/identify` API endpoint that:

- Receives a customer's email and/or phone number.
- Returns a consolidated contact profile linking all related contact records.
- Creates new contacts or links existing ones as primary/secondary according to business logic.
- Ensures the oldest contact is always the primary contact and all linked contacts are secondary.

This solution supports use cases where customers place multiple orders with overlapping contact details, enabling accurate identity resolution across purchases.

---

## Features

- Contact consolidation based on email or phone number.
- Creation of new contacts if no match found.
- Linking of contacts when partial overlap is found.
- Primary/secondary contact precedence handling.
- RESTful `/identify` POST API.
- PostgreSQL + Prisma ORM integration.
- Full TypeScript support.
- Basic unit and integration tests covering key flows.
- Live deployed demo on Render.

---

## Tech Stack

- Node.js (v16+)
- Express.js
- TypeScript
- Prisma ORM
- PostgreSQL
- Jest & Supertest for testing

---

## Getting Started

### Prerequisites

- Node.js installed (v16+ recommended)
- PostgreSQL database running

### Installation & Setup

1. Clone the repo:

   ```bash
   git clone https://github.com/sachin3825/bitespeed-assignment.git
   cd bitespeed-assignment


2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:

   ```
   DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME"
   PORT=3000
   ```

   * Replace `USER`, `PASSWORD`, `HOST`, `PORT`, and `DATABASE_NAME` with your PostgreSQL credentials.
   * `PORT` sets the server listening port (default is 3000).

4. Run Prisma migrations and generate client:

   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

6. The server will be running at `http://localhost:3000`.

---

## API Usage

### POST `/api/identify`

**Request Body:**

```json
{
  "email": "customer@example.com",
  "phoneNumber": "1234567890"
}
```

* Either or both `email` and `phoneNumber` can be provided.

**Response:**

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["primary@example.com", "secondary@example.com"],
    "phoneNumbers": ["1234567890"],
    "secondaryContactIds": [2]
  }
}
```

* Consolidates all linked contacts.
* Ensures the oldest contact is primary.
* Lists secondary contact IDs.

---

## Testing

Tests are implemented with Jest and Supertest to cover:

* Creation of new primary contacts.
* Linking secondary contacts when overlaps found.
* Correct consolidation of emails, phone numbers, and contact IDs.
* Edge cases such as missing fields.

Run tests with:

```bash
npm test
```

---

## Deployment & Live Demo

This project is deployed on Render: [https://bitespeed-assignment-w8o9.onrender.com/](https://bitespeed-assignment-w8o9.onrender.com/)

> **Disclaimer:** Due to Render's free-tier cold start behavior, the server may take a few seconds to start on first request.

---
## Solution Explanation

* The core logic resides in the `/identify` controller.
* When a request comes in, the system queries existing contacts matching the email or phone.
* If no contacts found, a new primary contact is created.
* If matches found:

  * Identify the oldest contact as primary.
  * Link all other contacts as secondary by updating their `linkedId` and `linkPrecedence`.
  * Consolidate all emails and phone numbers into arrays with primary contact’s details first.
* The system maintains referential integrity and ensures a clean data structure for linked contacts.
* Prisma ORM abstracts database interactions with type safety and migrations support.

---

## Notes

* Make sure your PostgreSQL instance is up and accessible.
* Adjust `.env` variables accordingly.
* You can extend this project with authentication, more endpoints, or frontend integration.


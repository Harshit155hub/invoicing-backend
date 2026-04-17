# Invoicing Backend

A backend system for B2B automated invoicing — built with Express.js, PostgreSQL, BullMQ, and Redis.

I built this with three things in mind: state integrity, async processing that actually works under failure, and knowing exactly who did what and when.

---

## Project Structure
invoicing-backend/
│
├── src/
│   ├── config/
│   │   ├── db.js
│   │   └── schema.sql
│   │
│   ├── controllers/
│   │   └── invoiceController.js
│   │
│   ├── middleware/
│   │   └── auth.js
│   │
│   ├── routes/
│   │   └── invoiceRoutes.js
│   │
│   ├── queues/
│   │   └── invoiceQueue.js
│   │
│   ├── jobs/
│   │   └── invoiceWorker.js
│   │
│   ├── app.js
│   └── server.js
│
├── .env.example
├── .gitignore
├── compose.yml
├── Dockerfile
├── package.json
└── README.md
## Getting Started

### With Docker (the easy way)

```bash
docker-compose up --build
```

This starts everything — the app, PostgreSQL, and Redis — all wired together. No manual setup needed.

### Without Docker

1. Make sure PostgreSQL and Redis are running on your machine
2. Run the schema: `psql -U postgres invoicedb < src/config/schema.sql`
3. Copy `.env.example` to `.env` and fill in your values
4. `npm install && node src/server.js`

---

## Environment Variables
PORT=3000
DB_HOST=db
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_NAME=invoicedb
REDIS_HOST=redis
REDIS_PORT=6379
JWT_SECRET=your_secret_key_here

---

## API Endpoints

Every route requires an `Authorization: Bearer <token>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/invoices | Create a new invoice (starts as DRAFT) |
| GET | /api/invoices/:id | Fetch invoice with all line items |
| PATCH | /api/invoices/:id | Edit an invoice (DRAFT only) |
| POST | /api/invoices/:id/finalize | Move from DRAFT to FINALIZED |
| POST | /api/invoices/:id/pay | Mark a FINALIZED invoice as PAID |
| POST | /api/invoices/:id/void | Void an invoice (not allowed once PAID) |

---

## How the State Machine Works
DRAFT ──→ FINALIZED ──→ PAID
│              │
└──────────────└──→ VOID

- **DRAFT** — The invoice is still being worked on. You can edit line items and customer details freely.
- **FINALIZED** — The invoice is locked. A unique invoice number gets generated at this point, and background jobs kick off to handle PDF generation and email dispatch without holding up the API response.
- **PAID** — Done. Nothing can change it after this.
- **VOID** — Can be reached from DRAFT or FINALIZED, but once something is PAID it's untouchable.

---

## Why I Made These Choices

**BullMQ instead of setTimeout**

I initially could have just used setTimeout to simulate the background jobs — it would have worked for a demo. But setTimeout isn't a real queue. If the server goes down while a job is running, that job is just gone. BullMQ persists jobs in Redis, retries on failure, and gives you visibility into what's running and what failed. For something like invoice delivery, that reliability actually matters.

**Database transactions everywhere**

When you create an invoice, you're writing to two tables at once — the invoice itself and its line items. I wrapped every multi-step operation in a transaction so if anything fails halfway through, the whole thing rolls back cleanly. No orphaned invoices, no missing line items.

**JWT on every route**

The audit trail needs to know who did what. If I don't enforce auth on every route, I can't reliably capture user IDs on state changes. JWT keeps it stateless — no sessions to manage, and it scales fine.

**Immutability after finalization**

Once an invoice goes out to a client it's basically a document of record. Letting it be edited after that point would create accounting headaches and break trust. So I enforce the status check at the application layer before any write operation — not just at the database level.

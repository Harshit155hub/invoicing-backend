# Invoicing Backend

A B2B automated invoicing system built with Express.js, PostgreSQL, BullMQ, and Redis.

## Local Setup

### With Docker (recommended)
```bash
docker-compose up --build
```

### Without Docker
1. Make sure PostgreSQL and Redis are running locally
2. Run the schema: `psql -U postgres invoicedb < src/config/schema.sql`
3. Copy `.env.example` to `.env` and fill in values
4. `npm install && node src/server.js`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/invoices | Create invoice (DRAFT) |
| GET | /api/invoices/:id | Get invoice + items |
| PATCH | /api/invoices/:id | Update DRAFT invoice |
| POST | /api/invoices/:id/finalize | DRAFT → FINALIZED |
| POST | /api/invoices/:id/pay | FINALIZED → PAID |
| POST | /api/invoices/:id/void | Any → VOID (except PAID) |

All routes require `Authorization: Bearer <token>` header.

## Architecture Decisions

**Why BullMQ over setTimeout?**
setTimeout blocks the event loop and has zero retry logic. BullMQ persists jobs in Redis — 
if the server crashes mid-job, the job survives and retries. That matters in production billing systems.

**Why database transactions?**
Creating an invoice involves two tables (invoices + invoice_items). Without a transaction, a crash 
halfway through leaves an invoice with no items. BEGIN/COMMIT/ROLLBACK makes it atomic.

**Why JWT middleware on every route?**
The audit log requirement explicitly asks for user IDs on state changes. Without auth middleware, 
you have no idea who finalized or paid what.

**State Machine**
DRAFT → FINALIZED → PAID are the happy path. VOID can be reached from DRAFT or FINALIZED. 
Once PAID, the invoice is immutable — no voids, no edits. Line items are locked on finalization 
by enforcing the status check before any write.
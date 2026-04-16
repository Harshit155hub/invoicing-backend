const pool = require("../config/db");
const { invoiceQueue } = require("../queues/invoiceQueue");

// Helper — always takes a client so it participates in the transaction
const logAudit = async (client, invoice_id, action, user_id = null) => {
  await client.query(
    "INSERT INTO audit_logs (invoice_id, action, user_id, created_at) VALUES ($1, $2, $3, NOW())",
    [invoice_id, action, user_id]
  );
};

exports.createInvoice = async (req, res) => {
  const { customer_name, items } = req.body;
  const userId = req.user?.id || null;

  if (!customer_name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "customer_name and items[] are required" });
  }

  let total = 0;
  for (const item of items) {
    if (!item.service || !item.quantity || !item.price) {
      return res.status(400).json({ message: "Each item needs service, quantity, and price" });
    }
    total += item.quantity * item.price;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const invoiceResult = await client.query(
      "INSERT INTO invoices (customer_name, total_amount, status) VALUES ($1, $2, 'DRAFT') RETURNING *",
      [customer_name, total]
    );
    const invoice = invoiceResult.rows[0];

    for (const item of items) {
      await client.query(
        "INSERT INTO invoice_items (invoice_id, service, quantity, price) VALUES ($1, $2, $3, $4)",
        [invoice.id, item.service, item.quantity, item.price]
      );
    }

    await logAudit(client, invoice.id, "CREATED", userId);
    await client.query("COMMIT");

    return res.status(201).json({ message: "Invoice created successfully", invoice });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Error creating invoice" });
  } finally {
    client.release();
  }
};

exports.getInvoice = async (req, res) => {
  try {
    const invoiceId = req.params.id;

    const invoiceResult = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
    const invoice = invoiceResult.rows[0];
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const itemsResult = await pool.query(
      "SELECT * FROM invoice_items WHERE invoice_id = $1",
      [invoiceId]
    );

    return res.json({ ...invoice, items: itemsResult.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error fetching invoice" });
  }
};

exports.finalizeInvoice = async (req, res) => {
  const invoiceId = req.params.id;
  const userId = req.user?.id || null;

  const check = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
  const invoice = check.rows[0];

  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (invoice.status !== "DRAFT") {
    return res.status(400).json({ message: "Only DRAFT invoices can be finalized" });
  }

  const invoiceNumber = `INV-${Date.now()}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updated = await client.query(
      "UPDATE invoices SET status = $1, invoice_number = $2, finalized_at = NOW() WHERE id = $3 RETURNING *",
      ["FINALIZED", invoiceNumber, invoiceId]
    );

    await logAudit(client, invoiceId, "FINALIZED", userId);
    await client.query("COMMIT");

    // Queue background jobs — non-blocking, after DB is committed
    await invoiceQueue.add("generate-pdf", { invoiceId, invoiceNumber });
    await invoiceQueue.add("send-email", {
      invoiceId,
      invoiceNumber,
      customerName: invoice.customer_name,
    });

    return res.json({ message: "Invoice finalized", data: updated.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Error finalizing invoice" });
  } finally {
    client.release();
  }
};

exports.updateInvoice = async (req, res) => {
  const invoiceId = req.params.id;
  const { customer_name, items } = req.body;
  const userId = req.user?.id || null;

  const check = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
  const invoice = check.rows[0];

  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (invoice.status !== "DRAFT") {
    return res.status(400).json({ message: "Only DRAFT invoices can be edited" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (customer_name) {
      await client.query("UPDATE invoices SET customer_name = $1 WHERE id = $2", [
        customer_name,
        invoiceId,
      ]);
    }

    if (Array.isArray(items) && items.length > 0) {
      let total = 0;
      for (const item of items) total += item.quantity * item.price;

      await client.query("DELETE FROM invoice_items WHERE invoice_id = $1", [invoiceId]);
      for (const item of items) {
        await client.query(
          "INSERT INTO invoice_items (invoice_id, service, quantity, price) VALUES ($1, $2, $3, $4)",
          [invoiceId, item.service, item.quantity, item.price]
        );
      }
      await client.query("UPDATE invoices SET total_amount = $1 WHERE id = $2", [
        total,
        invoiceId,
      ]);
    }

    await logAudit(client, invoiceId, "UPDATED", userId);
    await client.query("COMMIT");

    const updated = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
    return res.json({ message: "Invoice updated", data: updated.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Error updating invoice" });
  } finally {
    client.release();
  }
};

exports.markAsPaid = async (req, res) => {
  const invoiceId = req.params.id;
  const userId = req.user?.id || null;

  const check = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
  const invoice = check.rows[0];

  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (invoice.status !== "FINALIZED") {
    return res.status(400).json({ message: "Only FINALIZED invoices can be marked as paid" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updated = await client.query(
      "UPDATE invoices SET status = $1, paid_at = NOW() WHERE id = $2 RETURNING *",
      ["PAID", invoiceId]
    );

    await logAudit(client, invoiceId, "PAID", userId); // fixed: was "FINALIZED"
    await client.query("COMMIT");

    return res.json({ message: "Invoice marked as paid", data: updated.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Error marking invoice as paid" });
  } finally {
    client.release();
  }
};

exports.voidInvoice = async (req, res) => {
  const invoiceId = req.params.id;
  const userId = req.user?.id || null;

  const check = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
  const invoice = check.rows[0];

  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (invoice.status === "PAID") {
    return res.status(400).json({ message: "PAID invoices cannot be voided" });
  }
  if (invoice.status === "VOID") {
    return res.status(400).json({ message: "Invoice is already VOID" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updated = await client.query(
      "UPDATE invoices SET status = $1, voided_at = NOW() WHERE id = $2 RETURNING *",
      ["VOID", invoiceId]
    );

    await logAudit(client, invoiceId, "VOID", userId);
    await client.query("COMMIT");

    return res.json({ message: "Invoice voided", data: updated.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Error voiding invoice" });
  } finally {
    client.release();
  }
};
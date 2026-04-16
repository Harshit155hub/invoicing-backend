require("dotenv").config();
const express = require("express");
const app = express();

app.use(express.json());

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

const invoiceRoutes = require("./routes/invoiceRoutes");
app.use("/api/invoices", invoiceRoutes);

module.exports = app;

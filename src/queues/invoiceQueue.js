const { Queue } = require("bullmq");

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
};

const invoiceQueue = new Queue("invoice-jobs", { connection });

module.exports = { invoiceQueue };
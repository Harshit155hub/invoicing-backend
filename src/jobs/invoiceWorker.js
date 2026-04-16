const { Worker } = require("bullmq");

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
};

const worker = new Worker(
  "invoice-jobs",
  async (job) => {
    if (job.name === "generate-pdf") {
      const { invoiceId, invoiceNumber } = job.data;
      // Simulate PDF generation delay
      await new Promise((res) => setTimeout(res, 2000));
      console.log(`[PDF] Generated PDF for invoice ${invoiceNumber} (id: ${invoiceId})`);
    }

    if (job.name === "send-email") {
      const { invoiceId, invoiceNumber, customerName } = job.data;
      // Simulate email delay
      await new Promise((res) => setTimeout(res, 1000));
      console.log(
        `[EMAIL] Sent email to ${customerName} for invoice ${invoiceNumber} (id: ${invoiceId})`
      );
    }
  },
  { connection }
);

worker.on("completed", (job) => {
  console.log(`[WORKER] Job ${job.name} (${job.id}) completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[WORKER] Job ${job.name} (${job.id}) failed:`, err.message);
});

module.exports = worker;
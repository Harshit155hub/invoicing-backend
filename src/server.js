require("dotenv").config();
const app = require("./app");

// Start the BullMQ worker in the same process (fine for this scale)
require("./jobs/invoiceWorker");

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
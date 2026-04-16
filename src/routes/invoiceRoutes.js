const express = require("express");
const router = express.Router();
const controller = require("../controllers/invoiceController");
const auth = require("../middleware/auth");

router.post("/", auth, controller.createInvoice);
router.get("/:id", auth, controller.getInvoice);
router.patch("/:id", auth, controller.updateInvoice);
router.post("/:id/finalize", auth, controller.finalizeInvoice);
router.post("/:id/pay", auth, controller.markAsPaid);
router.post("/:id/void", auth, controller.voidInvoice);

module.exports = router;
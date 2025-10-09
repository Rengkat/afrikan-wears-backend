const express = require("express");
const { handlePaymentWebhook } = require("../controllers/transactionController");

const route = express.Router();

route.post("/webhook/paystack", handlePaymentWebhook);
module.exports = route;

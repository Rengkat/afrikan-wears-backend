const crypto = require("crypto");

const generatePaymentReference = (prefix, userId) => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}_${userId}_${timestamp}_${randomString}`;
};

module.exports = {
  generatePaymentReference,
};

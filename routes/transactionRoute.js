const express = require("express");
const {
  fundWallet,
  verifyWalletFunding,
  getAllTransactions,
  getCurrentUserTransactions,
  getUserTransactions,
  getTransactionDetail,
  checkPaymentStatus,
  getWalletBalance,
  getTransactionStatistics,
} = require("../controllers/transactionController");
const {
  authenticateUser,
  adminAuthorization,
  restrictToUser,
  adminAndStylistAuthorization,
} = require("../middleware/authentication");
const router = express.Router();
router.post("/fund-wallet", authenticateUser, fundWallet);
router.post("/verify-fund-wallet", authenticateUser, verifyWalletFunding);
router.get("/", authenticateUser, adminAuthorization, getAllTransactions);
router.get("/my-transactions", authenticateUser, getCurrentUserTransactions);
router.get("/check-status", authenticateUser, checkPaymentStatus);
router.get("/wallet/balance", authenticateUser, getWalletBalance);
router.get("/wallet/statistics", authenticateUser, adminAuthorization, getTransactionStatistics);
router.get("/user/:userId", authenticateUser, adminAuthorization, getUserTransactions);
router.get("/detail/:transactionId", authenticateUser, getTransactionDetail);

module.exports = router;

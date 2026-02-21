const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/authentication");
const {
  register,
  verifyEmail,
  resendVerificationEmail,
  login,
  logout,
  refreshTokens,
  validateTokens,
  getCurrentUser,
  getActiveSessions,
  revokeSession,
  revokeAllOtherSessions,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");

// ─── Public Routes ────────────────────────────────────────────────────────────
router.post("/register", register);
router.post("/verify-email", verifyEmail);
router.post("/reverify-email", resendVerificationEmail);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/refresh-token", refreshTokens);
router.get("/validate-tokens", validateTokens);

// ─── Protected Routes ─────────────────────────────────────────────────────────
router.get("/me", authenticateUser, getCurrentUser);
router.post("/logout", authenticateUser, logout);

// ─── Session Management ───────────────────────────────────────────────────────
router.get("/sessions", authenticateUser, getActiveSessions);
router.delete("/sessions/:sessionId", authenticateUser, revokeSession);
router.delete("/sessions", authenticateUser, revokeAllOtherSessions);

module.exports = router;

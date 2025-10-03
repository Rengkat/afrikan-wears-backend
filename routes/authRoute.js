const {
  register,
  verifyEmail,
  login,
  logout,
  forgotPassword,
  resetPassword,
  googleAuth,
  resendVerificationEmail,
  getCurrentUser,
  refreshTokens,
  validateTokens,
} = require("../controllers/authController");
const passport = require("passport");
const express = require("express");
const { authenticateUser } = require("../middleware/authentication");
const router = express.Router();
router.post("/register", register);
router.post("/verify-email", verifyEmail);
router.post("/reverify-email", resendVerificationEmail);
router.post("/login", login);
router.get("/me", authenticateUser, getCurrentUser);
router.post("/logout", authenticateUser, logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/refresh-token", refreshTokens);
router.post("/validate-tokens", validateTokens);
// router.get(
//   "/google",
//   passport.authenticate("google", {
//     scope: ["profile", "email"],
//     session: false,
//   })
// );

// router.get(
//   "/google/callback",
//   passport.authenticate("google", {
//     failureRedirect: "/login",
//     session: false,
//   }),
//   googleAuth
// );
module.exports = router;

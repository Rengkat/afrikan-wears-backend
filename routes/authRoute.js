const {
  register,
  verifyEmail,
  login,
  logout,
  forgotPassword,
  resetPassword,
  googleAuth,
} = require("../controllers/authController");
const passport = require("passport");
const express = require("express");
const { authenticateUser } = require("../middleware/authentication");
const router = express.Router();
router.post("/register", register);
router.post("/verify-email", verifyEmail);
router.post("/login", login);
router.post("/logout", authenticateUser, logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
    session: false,
  }),
  googleAuth
);
module.exports = router;

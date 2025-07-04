const express = require("express");
const router = express.Router();
const {
  authenticateUser,
  adminAuthorization,
  adminAndStylistAuthorization,
  stylistAuthorization,
} = require("../middleware/authentication");
const {
  getAllStylists,
  addStylist,
  getSingleStylist,
  updateStylist,
  updateStylistProfile,
  deleteStylist,
  uploadStylistAvatar,
  uploadStylistBanner,
  addPortfolioImage,
  removePortfolioImage,
} = require("../controllers/stylistController");

// Public routes
router.route("/").get(getAllStylists);
router.route("/:id").get(getSingleStylist);

// Admin-only routes
router.route("/").post(authenticateUser, adminAuthorization, addStylist);
router.route("/:id").delete(authenticateUser, adminAuthorization, deleteStylist);

// Admin or stylist routes (full update)
router
  .route("/:id")
  .patch(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), updateStylist);

// Stylist profile-specific routes
router.route("/:id/profile").patch(authenticateUser, stylistAuthorization, updateStylistProfile);

// Image upload routes
router
  .route("/:id/upload-avatar")
  .post(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), uploadStylistAvatar);

router
  .route("/:id/upload-banner")
  .post(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), uploadStylistBanner);

router
  .route("/:id/portfolio")
  .post(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), addPortfolioImage);

router
  .route("/:id/portfolio/:imageId")
  .delete(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), removePortfolioImage);

module.exports = router;

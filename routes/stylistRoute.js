const express = require("express");
const router = express.Router();
const {
  authenticateUser,
  authorize, // ADD THIS - generic role checker
  adminAuthorization,
  stylistAuthorization,
  checkStylistOwnership, // ADD THIS - ownership middleware
} = require("../middleware/authentication");

const {
  getAllStylists,
  addStylist,
  getSingleStylist,
  updateStylist,
  updateStylistProfile,
  deleteStylist,
  verifyStylistCompany, // ADD THIS - missing controller
  uploadStylistAvatar,
  uploadStylistBanner,
  addPortfolioImage,
  removePortfolioImage,
} = require("../controllers/stylistController");

// ==================== PUBLIC ROUTES ====================
router.route("/").get(getAllStylists);
router.route("/:id").get(getSingleStylist);

// ==================== ADMIN-ONLY ROUTES ====================
router.route("/").post(authenticateUser, adminAuthorization, addStylist);
router.route("/verify/:id").patch(authenticateUser, adminAuthorization, verifyStylistCompany); // ADD THIS
router.route("/:id").delete(authenticateUser, adminAuthorization, deleteStylist);

// ==================== STYLIST MANAGEMENT ROUTES ====================
// Admin can update any stylist, stylist can only update their own
router
  .route("/:id")
  .patch(authenticateUser, authorize("admin", "stylist"), checkStylistOwnership, updateStylist);

// ==================== STYLIST-ONLY PROFILE ROUTES ====================
// Stylist can only update their own profile
router
  .route("/:id/profile")
  .patch(authenticateUser, stylistAuthorization, checkStylistOwnership, updateStylistProfile);

// ==================== IMAGE UPLOAD ROUTES ====================
// Admin can upload for any, stylist only for their own
router
  .route("/:id/upload-avatar")
  .post(
    authenticateUser,
    authorize("admin", "stylist"),
    checkStylistOwnership,
    uploadStylistAvatar
  );

router
  .route("/:id/upload-banner")
  .post(
    authenticateUser,
    authorize("admin", "stylist"),
    checkStylistOwnership,
    uploadStylistBanner
  );

router
  .route("/:id/portfolio")
  .post(authenticateUser, authorize("admin", "stylist"), checkStylistOwnership, addPortfolioImage);

router
  .route("/:id/portfolio/:imageId")
  .delete(
    authenticateUser,
    authorize("admin", "stylist"),
    checkStylistOwnership,
    removePortfolioImage
  );

module.exports = router;

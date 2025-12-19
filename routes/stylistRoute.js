const express = require("express");
const router = express.Router();
const {
  authenticateUser,
  authorize,
  adminAuthorization,
  stylistAuthorization,
  checkStylistOwnership,
} = require("../middleware/authentication");

const {
  getAllStylists,
  addStylist,
  getSingleStylist,
  updateStylist,
  updateStylistProfile,
  deleteStylist,
  verifyStylistCompany,
  uploadStylistAvatar,
  uploadStylistBanner,
  addPortfolioImage,
  removePortfolioImage,
  getMyStylistProfile,uploadStylistDocument
} = require("../controllers/stylistController");

// Public routes
router.route("/").get(getAllStylists);
router.route("/").post(authenticateUser, adminAuthorization, addStylist);
// Stylist profile routes
router
  .route("/my/profile")
  .get(authenticateUser, stylistAuthorization, getMyStylistProfile)
  .patch(authenticateUser, stylistAuthorization, updateStylistProfile);

router.route("/:id").get(getSingleStylist);

// Admin-only routes
router.route("/:id").delete(authenticateUser, adminAuthorization, deleteStylist);
router.route("/:id").patch(authenticateUser, adminAuthorization, updateStylist);
router.route("/verify/:id").patch(authenticateUser, adminAuthorization, verifyStylistCompany);

// Upload routes (both admin and stylist with ownership)
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

  router
  .route("/:id/upload-document")
  .post(
    authenticateUser,
    authorize("admin", "stylist"),
    checkStylistOwnership,
    uploadStylistDocument
  );
module.exports = router;

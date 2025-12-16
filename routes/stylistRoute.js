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
  verifyStylistCompany,
  uploadStylistAvatar,
  uploadStylistBanner,
  addPortfolioImage,
  removePortfolioImage,
  getMyStylistProfile,
} = require("../controllers/stylistController");

router.route("/").get(getAllStylists);
router.route("/").post(authenticateUser, adminAuthorization, addStylist);

router.get("/my/profile", authenticateUser, stylistAuthorization, getMyStylistProfile);
router.route("/:id").get(getSingleStylist);

router.route("/verify/:id").patch(authenticateUser, adminAuthorization, verifyStylistCompany);
router.route("/:id").delete(authenticateUser, adminAuthorization, deleteStylist);

router
  .route("/:id")
  .patch(authenticateUser, authorize("admin", "stylist"), checkStylistOwnership, updateStylist);

router
  .route("/:id/profile")
  .patch(authenticateUser, stylistAuthorization, checkStylistOwnership, updateStylistProfile);

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

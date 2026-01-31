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
  getMyStylistProfile,
  uploadStylistDocument,
  suspendStylist,
  getProductsByStylist,
} = require("../controllers/stylistController");

router.route("/").get(getAllStylists);
router.route("/").post(authenticateUser, adminAuthorization, addStylist);
// Stylist profile routes
router
  .route("/my/profile")
  .get(authenticateUser, stylistAuthorization, getMyStylistProfile)
  .patch(authenticateUser, stylistAuthorization, updateStylistProfile);

router
  .route("/:id")
  .get(getSingleStylist)
  .delete(authenticateUser, adminAuthorization, deleteStylist)
  .patch(authenticateUser, adminAuthorization, updateStylist);
router.get("/products/:id", getProductsByStylist);
router.route("/verify/:id").patch(authenticateUser, adminAuthorization, verifyStylistCompany);

// In your stylist routes
router.route("/suspend/:id").patch(authenticateUser, adminAuthorization, suspendStylist);

router
  .route("/:id/upload-avatar")
  .post(
    authenticateUser,
    authorize("admin", "stylist"),
    checkStylistOwnership,
    uploadStylistAvatar,
  );

router
  .route("/:id/upload-banner")
  .post(
    authenticateUser,
    authorize("admin", "stylist"),
    checkStylistOwnership,
    uploadStylistBanner,
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
    removePortfolioImage,
  );

router
  .route("/:id/upload-document")
  .post(
    authenticateUser,
    authorize("admin", "stylist"),
    checkStylistOwnership,
    uploadStylistDocument,
  );
module.exports = router;

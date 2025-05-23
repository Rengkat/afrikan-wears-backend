const express = require("express");
const {
  authenticateUser,
  adminAndStylistAuthorization,
  stylistAuthorization,
  adminAuthorization,
} = require("../middleware/authentication");
const {
  addProduct,
  getAllProducts,
  getDetailProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  addReview,
  updateReview,
  verifyProduct,
} = require("../controllers/productController");
const router = express.Router();
router
  .route("/")
  .post(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), addProduct)
  .get(getAllProducts);
router
  .route("/upload-product-image")
  .post(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), uploadProductImage);
router
  .route("/:productId")
  .get(getDetailProduct)
  .patch(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), updateProduct)
  .delete(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), deleteProduct);
router.put("/verify/:productId", authenticateUser, adminAuthorization, verifyProduct);
router.route("/:productId/review").post(authenticateUser, addReview);
router.route("/:productId/review/:reviewId").post(authenticateUser, updateReview);
module.exports = router;

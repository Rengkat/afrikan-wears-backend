const express = require("express");
const {
  authenticateUser,
  adminAndStylistAuthorization,
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
  getMyProducts,
  deleteProductImage,
  getApprovedProducts,
} = require("../controllers/productController");
const router = express.Router();

// Public routes
router.route("/").get(getApprovedProducts);

// Protected routes
router
  .route("/")
  .post(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), addProduct);

router
  .route("/my-products")
  .get(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), getMyProducts);
router.route("/all-products-admin").get(authenticateUser, adminAuthorization, getAllProducts);

router
  .route("/upload-product-image")
  .post(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), uploadProductImage);
router
  .route("/delete-product-image")
  .delete(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), deleteProductImage);
router.route("/:productId").get(getDetailProduct);
router
  .route("/:productId")
  .patch(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), updateProduct)
  .delete(authenticateUser, adminAndStylistAuthorization("stylist", "admin"), deleteProduct);

router.route("/verify/:productId").put(authenticateUser, adminAuthorization, verifyProduct);

// Review routes
router.route("/:productId/review").post(authenticateUser, addReview);
router.route("/:productId/review/:reviewId").patch(authenticateUser, updateReview);

module.exports = router;

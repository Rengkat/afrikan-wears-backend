const express = require("express");
const router = express.Router();
const {
  addToCart,
  removeFromCart,
  updateCart,
  getAllCartProducts,
  clearCart,
  moveToWishlist,
  mergeCart,
} = require("../controllers/cartController");
const { authenticateUser, authorize } = require("../middleware/authentication");

router
  .route("/")
  .post(authenticateUser, authorize("user"), addToCart)
  .get(authenticateUser, getAllCartProducts);
router.post("/merge", authenticateUser, mergeCart);
router.post("/clear-cart", authenticateUser, clearCart);
router.route("/move-to-wishlist").post(authenticateUser, authorize("user"), moveToWishlist);

router
  .route("/:id")
  .delete(authenticateUser, authorize("user"), removeFromCart)
  .patch(authenticateUser, authorize("user"), updateCart);

module.exports = router;

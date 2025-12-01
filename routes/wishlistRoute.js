const express = require("express");
const router = express.Router();
const {
  addToWishlist,
  getMyWishlist,
  removeFromWishlist,
  moveToCart,
} = require("../controllers/wishlistController");
const { authenticateUser, authorize } = require("../middleware/authentication");

router.use(authenticateUser);

router
  .route("/")
  .post(authenticateUser, authorize("user"), addToWishlist)
  .get(authenticateUser, authorize("user"), getMyWishlist);

router.route("/:productId").delete(authenticateUser, authorize("user"), removeFromWishlist);

router.route("/move-to-cart").post(authenticateUser, authorize("user"), moveToCart);

module.exports = router;

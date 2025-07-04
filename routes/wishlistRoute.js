const express = require("express");
const router = express.Router();
const {
  addToWishlist,
  getMyWishlist,
  removeFromWishlist,
  moveToCart,
} = require("../controllers/wishlistController");
const { authenticateUser, restrictToUser } = require("../middleware/authentication");

router.use(authenticateUser);

router
  .route("/")
  .post(authenticateUser, restrictToUser("user"), addToWishlist)
  .get(authenticateUser, restrictToUser("user"), getMyWishlist);

router.route("/:productId").delete(authenticateUser, restrictToUser("user"), removeFromWishlist);

router.route("/move-to-cart").post(authenticateUser, restrictToUser("user"), moveToCart);

module.exports = router;

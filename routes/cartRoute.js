const express = require("express");
const router = express.Router();
const {
  addToCart,
  removeFromCart,
  updateCart,
  getAllCartProducts,
  clearCart,
} = require("../controllers/cartController");
const { authenticateUser, authorize } = require("../middleware/authentication");

router
  .route("/")
  .post(authenticateUser, authorize("user"), addToCart)
  .get(authenticateUser, authorize("user"), getAllCartProducts);
router.post("/clear-cart", authenticateUser, clearCart);
router
  .route("/:id")
  .delete(authenticateUser, authorize("user"), removeFromCart)
  .patch(authenticateUser, authorize("user"), updateCart);

module.exports = router;

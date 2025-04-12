const express = require("express");
const router = express.Router();
const {
  addToCart,
  removeFromCart,
  updateCart,
  getAllCartProducts,
} = require("../controllers/cartController");
const { authenticateUser, restrictToUser } = require("../middleware/authentication");

router
  .route("/")
  .post(authenticateUser, restrictToUser("user"), addToCart)
  .get(authenticateUser, getAllCartProducts);
router.route("/:id").delete(authenticateUser, removeFromCart).patch(authenticateUser, updateCart);

module.exports = router;

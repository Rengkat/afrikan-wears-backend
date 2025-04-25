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
  .get(authenticateUser, restrictToUser("user"), getAllCartProducts);
router
  .route("/:id")
  .delete(authenticateUser, restrictToUser("user"), removeFromCart)
  .patch(authenticateUser, restrictToUser("user"), updateCart);

module.exports = router;

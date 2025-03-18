const express = require("express");
const router = express.Router();
const { addToCart, removeFromCart, updateCart } = require("../controllers/cartController");
const { authenticateUser } = require("../middleware/authentication");

router.post("/add", authenticateUser, addToCart);
router.route("/:id").delete(authenticateUser, removeFromCart).patch(authenticateUser, updateCart);

module.exports = router;

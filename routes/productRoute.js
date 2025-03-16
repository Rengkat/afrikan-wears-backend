const express = require("express");
const {
  authenticateUser,
  adminAndStylistAuthorization,
  stylistAuthorization,
} = require("../middleware/authentication");
const { addProduct, getAllProducts } = require("../controllers/productController");
const router = express.Router();
router
  .route("/")
  .post(adminAndStylistAuthorization("stylist", "admin"), addProduct)
  .get(getAllProducts);
module.exports = router;

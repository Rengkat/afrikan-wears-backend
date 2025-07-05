const express = require("express");
const { authenticateUser } = require("../middleware/authentication");

const {
  getAllAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
} = require("../controllers/addressController");
const router = express.Router();

router.use(authenticateUser);

router.route("/").get(getAllAddresses).post(createAddress);

router.route("/:id").patch(updateAddress).delete(deleteAddress);

router.patch("/:id/default", setDefaultAddress);

module.exports = router;

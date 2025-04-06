const express = require("express");
const router = express.Router();
// const {} = require("../controllers/brandController");
const {
  authenticateUser,
  adminAuthorization,
  adminAndStylistAuthorization,
} = require("../middleware/authentication");
const {
  getAllStylists,
  addStylist,
  getSingleStylist,
  updateStylist,
  deleteStylist,
} = require("../controllers/stylistController");

router.route("/").get(getAllStylists).post(authenticateUser, adminAuthorization, addStylist);
router
  .route("/:id")
  .get(getSingleStylist)
  .patch(authenticateUser, adminAndStylistAuthorization, updateStylist)
  .delete(deleteStylist);

module.exports = router;

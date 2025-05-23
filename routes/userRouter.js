const express = require("express");
const {
  getAllUsers,
  getDetailUser,
  updateCurrentUser,
  updateUser,
  deleteUser,
  getMyProfile,
} = require("../controllers/userController");
const {
  authenticateUser,
  adminAndStylistAuthorization,
  adminAuthorization,
} = require("../middleware/authentication");

const router = express.Router();

router.route("/").get(authenticateUser, adminAuthorization, getAllUsers);

router.route("/me").get(authenticateUser, getMyProfile).patch(authenticateUser, updateCurrentUser);
router
  .route("/:id")
  .get(authenticateUser, adminAuthorization, getDetailUser)
  .patch(authenticateUser, adminAuthorization, updateUser)
  .delete(authenticateUser, adminAuthorization, deleteUser);

module.exports = router;

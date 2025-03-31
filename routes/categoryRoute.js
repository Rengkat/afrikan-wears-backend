const express = require("express");
const router = express.Router();
const {
  createCategory,
  getAllCategories,
  getSingleCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/categoryController");
const { authenticateUser, adminAuthorization } = require("../middleware/authentication");

router.route("/").get(getAllCategories).post(authenticateUser, adminAuthorization, createCategory);
router
  .route("/:id")
  .get(getSingleCategory)
  .patch(authenticateUser, adminAuthorization, updateCategory)
  .delete(deleteCategory);

module.exports = router;

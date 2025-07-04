const express = require("express");
const router = express.Router();
const {
  getNotifications,
  markAsRead,
  deleteNotification,
  getUnreadCount,
} = require("../controllers/notificationController");
const { authenticateUser } = require("../middleware/authentication");

router.route("/").get(authenticateUser, getNotifications);

router.route("/unread-count").get(authenticateUser, getUnreadCount);

router.route("/:id/read").patch(authenticateUser, markAsRead);

router.route("/:id").delete(authenticateUser, deleteNotification);

module.exports = router;

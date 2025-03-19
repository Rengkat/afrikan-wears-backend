const express = require("express");
const { authenticateUser } = require("../middleware/authentication");
const {
  sendMessage,
  getMessages,
  updateMessage,
  deleteMessage,
} = require("../controllers/messagesController");
const router = express.Router();

router.route("/").post(authenticateUser, sendMessage).get(authenticateUser, getMessages);
router.route("/id").patch(authenticateUser, updateMessage).delete(authenticateUser, deleteMessage);
module.exports = router;

const express = require("express");
const { authenticateUser } = require("../middleware/authentication");
const {
  sendMessage,
  getMessages,
  updateMessage,
  deleteMessage,
  uploadMessageImage,
  getChats,
} = require("../controllers/messagesController");
const router = express.Router();

router.route("/").post(authenticateUser, sendMessage);
router.get("/chats", authenticateUser, getChats);
router.route("/upload-image", authenticateUser, uploadMessageImage);
router.route("/id").patch(authenticateUser, updateMessage).delete(authenticateUser, deleteMessage);
router.route("/:senderId/:receiverId").get(authenticateUser, getMessages);
module.exports = router;

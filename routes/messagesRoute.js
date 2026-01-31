const express = require("express");
const { authenticateUser } = require("../middleware/authentication");
const {
  sendMessage,
  getMessages,
  updateMessage,
  deleteMessage,
  uploadMessageImage,
  getChats,
  startChat,
  getUnreadMessagesCount,
  getUnreadCountByChat,
} = require("../controllers/messagesController");
const rateLimit = require("express-rate-limit");

const router = express.Router();

// Rate limiting for chat endpoints
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    success: false,
    message: "Too many requests, please try again after 15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
router.route("/").get(authenticateUser, getMessages).post(authenticateUser, sendMessage);
router.get("/chats", authenticateUser, getChats);
router.post("/start-chat", chatLimiter, authenticateUser, startChat);
router.post("/upload-image", authenticateUser, uploadMessageImage);
router.get("/unread-count", authenticateUser, getUnreadMessagesCount);
router.get("/unread-by-chat", authenticateUser, getUnreadCountByChat);
router.route("/:id").patch(authenticateUser, updateMessage).delete(authenticateUser, deleteMessage);

module.exports = router;

// socket/messageSocket.js
const Message = require("../models/messageModel");
const User = require("../models/userModel");
const mongoose = require("mongoose");

const setupMessageSocket = (io) => {
  // Store connected users
  const connectedUsers = new Map(); // userId -> socketId

  io.on("connection", (socket) => {
    console.log("New socket connection:", socket.id);

    // User joins their personal room
    socket.on("join", (userId) => {
      if (!userId) return;

      socket.join(userId);
      connectedUsers.set(userId, socket.id);
      console.log(`User ${userId} joined room and mapped to socket ${socket.id}`);

      // Notify user they're connected
      socket.emit("connected", { userId, socketId: socket.id });
    });

    // Handle sending messages via socket
    socket.on("sendMessage", async (data) => {
      try {
        const { sender, receiver, content, image } = data;

        console.log("Received sendMessage event:", {
          sender,
          receiver,
          content: content?.substring(0, 50) || "No content",
          hasImage: !!image,
        });

        // Validate required fields
        if (!sender || !receiver) {
          console.error("Missing sender or receiver");
          socket.emit("messageError", {
            error: "Sender and receiver are required",
          });
          return;
        }

        if (!content && !image) {
          console.error("Message must have content or image");
          socket.emit("messageError", {
            error: "Message must contain text or image",
          });
          return;
        }

        // Validate ObjectIds
        if (
          !mongoose.Types.ObjectId.isValid(sender) ||
          !mongoose.Types.ObjectId.isValid(receiver)
        ) {
          console.error("Invalid ObjectId format");
          socket.emit("messageError", {
            error: "Invalid user ID format",
          });
          return;
        }

        // Convert to ObjectIds
        const senderId = new mongoose.Types.ObjectId(sender);
        const receiverId = new mongoose.Types.ObjectId(receiver);

        // Check if sender is sending to themselves
        if (senderId.equals(receiverId)) {
          console.error("User trying to message themselves");
          socket.emit("messageError", {
            error: "Cannot send message to yourself",
          });
          return;
        }

        // Verify both users exist
        const [senderUser, receiverUser] = await Promise.all([
          User.findById(senderId).select("firstName surname avatar role"),
          User.findById(receiverId).select("firstName surname avatar role"),
        ]);

        if (!senderUser || !receiverUser) {
          console.error("Sender or receiver not found");
          socket.emit("messageError", {
            error: "User not found",
          });
          return;
        }

        // Create message in database
        const newMessage = await Message.create({
          sender: senderId,
          receiver: receiverId,
          content: content || "",
          image: image || null,
          read: false,
          timestamp: new Date(),
        });

        console.log("Message saved to database:", newMessage._id);

        // Populate the message
        const populatedMessage = await Message.findById(newMessage._id)
          .populate("sender", "firstName surname avatar companyName role")
          .populate("receiver", "firstName surname avatar companyName role")
          .lean();

        console.log("Message populated, emitting to rooms:", {
          sender: sender,
          receiver: receiver,
        });

        // Emit to both sender and receiver rooms
        io.to(sender).emit("newMessage", populatedMessage);
        io.to(receiver).emit("newMessage", populatedMessage);

        console.log("Message emitted successfully");

        // Emit unread count update to receiver
        const unreadCount = await Message.countDocuments({
          receiver: receiverId,
          read: false,
        });

        io.to(receiver).emit("unreadCountUpdate", { count: unreadCount });
        console.log(`Unread count updated for receiver: ${unreadCount}`);

        // Send confirmation to sender
        socket.emit("messageSent", {
          success: true,
          messageId: newMessage._id,
        });
      } catch (error) {
        console.error("Error in sendMessage socket handler:", error);
        socket.emit("messageError", {
          error: error.message || "Failed to send message",
        });
      }
    });

    // Handle marking messages as read
    socket.on("markAsRead", async (data) => {
      try {
        const { messageIds, userId } = data;

        if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
          return;
        }

        console.log(`Marking ${messageIds.length} messages as read for user ${userId}`);

        // Update messages
        await Message.updateMany(
          {
            _id: { $in: messageIds },
            receiver: userId,
            read: false,
          },
          { read: true },
        );

        // Get updated messages and emit to sender
        const updatedMessages = await Message.find({
          _id: { $in: messageIds },
        })
          .populate("sender", "firstName surname avatar companyName role")
          .populate("receiver", "firstName surname avatar companyName role")
          .lean();

        // Emit update to each message's sender
        updatedMessages.forEach((msg) => {
          const senderId = msg.sender._id.toString();
          io.to(senderId).emit("messageUpdated", msg);
        });

        // Update unread count for the user who read the messages
        const unreadCount = await Message.countDocuments({
          receiver: userId,
          read: false,
        });

        io.to(userId.toString()).emit("unreadCountUpdate", { count: unreadCount });
        console.log(`Messages marked as read. New unread count: ${unreadCount}`);
      } catch (error) {
        console.error("Error marking messages as read:", error);
      }
    });

    // Handle message deletion
    socket.on("deleteMessage", async (data) => {
      try {
        const { messageId, userId } = data;

        if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
          socket.emit("messageError", { error: "Invalid message ID" });
          return;
        }

        const message = await Message.findOneAndDelete({
          _id: messageId,
          sender: userId, // Only sender can delete
        });

        if (!message) {
          socket.emit("messageError", {
            error: "Message not found or unauthorized",
          });
          return;
        }

        // Emit to both users
        io.to(message.sender.toString()).emit("messageDeleted", {
          messageId: message._id,
        });
        io.to(message.receiver.toString()).emit("messageDeleted", {
          messageId: message._id,
        });

        console.log(`Message ${messageId} deleted`);
      } catch (error) {
        console.error("Error deleting message:", error);
        socket.emit("messageError", {
          error: "Failed to delete message",
        });
      }
    });

    // Handle user typing
    socket.on("typing", (data) => {
      const { sender, receiver } = data;
      io.to(receiver).emit("userTyping", { userId: sender, typing: true });
    });

    socket.on("stopTyping", (data) => {
      const { sender, receiver } = data;
      io.to(receiver).emit("userTyping", { userId: sender, typing: false });
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      // Remove user from connected users map
      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          console.log(`User ${userId} disconnected`);
          break;
        }
      }
      console.log("Socket disconnected:", socket.id);
    });
  });

  console.log("Message socket handlers initialized");
};

module.exports = setupMessageSocket;

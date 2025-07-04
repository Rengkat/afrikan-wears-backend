const CustomError = require("../errors");
const Notification = require("../models/notificationModel");
// Standardized notification emitter
const emitNotification = async (io, eventName, payload, target) => {
  if (!io) {
    throw new CustomError.BadRequestError("Socket.IO instance (io) is undefined");
  }

  if (!eventName || !payload || !target) {
    throw new CustomError.BadRequestError("Missing required parameters for notification");
  }

  try {
    // Persist notification to database
    const notification = await Notification.create({
      recipient: target,
      type: payload.type,
      message: payload.message,
      data: payload.data,
      ...(payload.sender && { sender: payload.sender }),
    });

    // Emit via socket
    if (Array.isArray(target)) {
      target.forEach((userId) => {
        io.to(userId.toString()).emit(eventName, notification);
      });
    } else {
      io.to(target.toString()).emit(eventName, notification);
    }
  } catch (error) {
    console.error("Notification emission failed:", error);
    throw error;
  }
};

// Enhanced message event emitter
const emitMessageEvent = (io, eventName, message, initiatorId = null) => {
  if (!io || !message) {
    throw new CustomError.BadRequestError("Invalid parameters for message emission");
  }

  const validEvents = ["newMessage", "messageUpdated", "messageDeleted"];
  if (!validEvents.includes(eventName)) {
    throw new CustomError.BadRequestError(`Invalid message event: ${eventName}`);
  }

  try {
    const senderId = message.sender?.toString();
    const receiverId = message.receiver?.toString();

    if (!senderId || !receiverId) {
      throw new CustomError.BadRequestError("Message missing sender/receiver");
    }

    switch (eventName) {
      case "newMessage":
        io.to(senderId).emit(eventName, message); // For UI confirmation
        io.to(receiverId).emit(eventName, message);
        break;

      case "messageDeleted":
        const targetId = initiatorId?.toString() === senderId ? receiverId : senderId;
        io.to(targetId).emit(eventName, message);
        break;

      default:
        io.to(senderId).emit(eventName, message);
        io.to(receiverId).emit(eventName, message);
    }

    console.log(`Emitted ${eventName} between ${senderId} and ${receiverId}`);
  } catch (error) {
    console.error("Message emission failed:", error);
    throw error;
  }
};

module.exports = { emitNotification, emitMessageEvent };

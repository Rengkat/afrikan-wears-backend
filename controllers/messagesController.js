const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const Message = require("../models/messageModel");
const User = require("../models/userModel");
const mongoose = require("mongoose");
const fs = require("fs").promises;

const { emitMessageEvent, writeClient } = require("../utils");
// Add to your message controller
const startChat = async (req, res, next) => {
  try {
    const { receiverId } = req.body;
    const senderId = req.user.id;

    console.log("Starting chat - Sender:", senderId, "Receiver:", receiverId);

    // Validate IDs
    if (!receiverId) {
      throw new CustomError.BadRequestError("Receiver ID is required");
    }

    if (senderId === receiverId) {
      throw new CustomError.BadRequestError("Cannot start chat with yourself");
    }

    if (!mongoose.isValidObjectId(receiverId)) {
      throw new CustomError.BadRequestError("Invalid receiver ID format");
    }

    // Check if receiver exists - could be User OR Stylist owner
    let receiver = await User.findById(receiverId);

    // If receiver is a stylist, get the owner user
    if (!receiver) {
      const stylist = await Stylist.findById(receiverId);
      if (stylist && stylist.owner) {
        receiver = await User.findById(stylist.owner);
      }
    }

    if (!receiver) {
      throw new CustomError.NotFoundError("Receiver not found");
    }

    // Check if chat already exists
    const existingMessages = await Message.findOne({
      $or: [
        { sender: senderId, receiver: receiver._id },
        { sender: receiver._id, receiver: senderId },
      ],
    }).sort({ timestamp: -1 });

    if (existingMessages) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Chat already exists",
        chatId: existingMessages._id,
        chatExists: true,
      });
    }

    // Create welcome message with actual receiver ID (user ID)
    const welcomeMessage = await Message.create({
      sender: senderId,
      receiver: receiver._id,
      content: `Hi! I'd like to chat with you about your products/services.`,
      read: false,
      timestamp: new Date(),
    });

    // Populate message
    const populatedMessage = await Message.findById(welcomeMessage._id)
      .populate("sender", "firstName surname avatar companyName role")
      .populate("receiver", "firstName surname avatar companyName role");

    // Emit socket event
    if (req.io) {
      emitMessageEvent(req.io, "newMessage", populatedMessage);
    }

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Chat started successfully",
      chatId: populatedMessage._id,
      data: populatedMessage,
    });
  } catch (error) {
    console.error("Error in startChat:", error);
    next(error);
  }
};
const sendMessage = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { sender, receiver, content, image } = req.body;

    if (!sender || !receiver || !content) {
      throw new CustomError.BadRequestError("Please provide all fields");
    }

    // Convert string IDs to ObjectId
    const senderId = new mongoose.Types.ObjectId(sender);
    const receiverId = new mongoose.Types.ObjectId(receiver);

    if (senderId.equals(receiverId)) {
      throw new CustomError.BadRequestError("Cannot send message to yourself");
    }

    const message = await Message.create(
      [
        {
          sender: senderId,
          receiver: receiverId,
          content,
          image,
        },
      ],
      { session },
    );

    // Populate before emitting
    const populatedMessage = await Message.findById(message[0]._id)
      .populate("sender", "firstName surname avatar companyName role")
      .populate("receiver", "firstName surname avatar companyName role")
      .lean();

    // Emit the new message to both users
    emitMessageEvent(req.io, "newMessage", populatedMessage);

    await session.commitTransaction();
    res.status(StatusCodes.CREATED).json({
      success: true,
      data: populatedMessage,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
const getMessages = async (req, res, next) => {
  try {
    const { senderId, receiverId, page = 1, limit = 50 } = req.query; // FIXED: Changed from params to query

    // Validation
    if (!senderId || !receiverId) {
      throw new CustomError.BadRequestError("Sender ID and Receiver ID are required");
    }

    if (
      !mongoose.Types.ObjectId.isValid(senderId) ||
      !mongoose.Types.ObjectId.isValid(receiverId)
    ) {
      throw new CustomError.BadRequestError("Invalid sender or receiver ID");
    }

    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      Message.find({
        $or: [
          { sender: senderId, receiver: receiverId },
          { sender: receiverId, receiver: senderId },
        ],
      })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .populate("sender", "firstName surname avatar companyName role")
        .populate("receiver", "firstName surname avatar companyName role")
        .lean(),
      Message.countDocuments({
        $or: [
          { sender: senderId, receiver: receiverId },
          { sender: receiverId, receiver: senderId },
        ],
      }),
    ]);

    res.status(StatusCodes.OK).json({
      success: true,
      data: messages,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    next(error);
  }
};
const getUnreadMessagesCount = async (req, res, next) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      throw new CustomError.UnauthorizedError("User not authenticated");
    }

    // Count unread messages where current user is the receiver
    const unreadCount = await Message.countDocuments({
      receiver: userId,
      read: false,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      count: unreadCount,
    });
  } catch (error) {
    next(error);
  }
};

// Also add an endpoint to get unread count per conversation
const getUnreadCountByChat = async (req, res, next) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      throw new CustomError.UnauthorizedError("User not authenticated");
    }

    const currentUserObjectId = new mongoose.Types.ObjectId(userId);

    // Aggregate unread messages grouped by sender
    const unreadByChat = await Message.aggregate([
      {
        $match: {
          receiver: currentUserObjectId,
          read: false,
        },
      },
      {
        $group: {
          _id: "$sender",
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "senderInfo",
        },
      },
      {
        $unwind: "$senderInfo",
      },
      {
        $project: {
          senderId: "$_id",
          count: 1,
          senderName: {
            $concat: ["$senderInfo.firstName", " ", "$senderInfo.surname"],
          },
          senderAvatar: "$senderInfo.avatar",
        },
      },
    ]);

    res.status(StatusCodes.OK).json({
      success: true,
      data: unreadByChat,
    });
  } catch (error) {
    next(error);
  }
};
const markMessagesAsRead = async (req, res, next) => {
  try {
    const { messageIds } = req.body;
    const userId = req.user.id;

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      throw new CustomError.BadRequestError("Message IDs array is required");
    }

    // Validate all IDs
    const invalidIds = messageIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      throw new CustomError.BadRequestError(`Invalid message IDs: ${invalidIds.join(", ")}`);
    }

    // Update messages - only mark as read if current user is the receiver
    const result = await Message.updateMany(
      {
        _id: { $in: messageIds },
        receiver: userId,
        read: false,
      },
      { read: true },
    );

    console.log(`Marked ${result.modifiedCount} messages as read for user ${userId}`);

    res.status(StatusCodes.OK).json({
      success: true,
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} messages marked as read`,
    });
  } catch (error) {
    next(error);
  }
};

const getChats = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;

    if (!mongoose.isValidObjectId(currentUserId)) {
      throw new CustomError.BadRequestError("Invalid user ID");
    }

    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);

    const chats = await Message.aggregate([
      {
        $match: {
          $or: [{ sender: currentUserObjectId }, { receiver: currentUserObjectId }],
        },
      },
      {
        $sort: { timestamp: -1 },
      },
      {
        $group: {
          _id: {
            $cond: [{ $eq: ["$sender", currentUserObjectId] }, "$receiver", "$sender"],
          },
          lastMessage: { $first: "$content" },
          lastMessageTime: { $first: "$timestamp" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [{ $ne: ["$sender", currentUserObjectId] }, { $eq: ["$read", false] }],
                },
                1,
                0,
              ],
            },
          },
          lastMessageId: { $first: "$_id" },
          lastMessageSender: { $first: "$sender" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userInfo",
        },
      },
      {
        $unwind: {
          path: "$userInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "stylists",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$owner", "$$userId"] },
              },
            },
          ],
          as: "stylistInfo",
        },
      },
      {
        $addFields: {
          stylist: { $arrayElemAt: ["$stylistInfo", 0] },
        },
      },
      {
        $project: {
          userId: "$_id",
          userName: {
            $cond: {
              if: { $ne: ["$userInfo", null] },
              then: {
                $cond: {
                  // If user has a stylist profile, use company name
                  if: { $ne: ["$stylist", null] },
                  then: "$stylist.companyName",
                  // Otherwise use first name + surname
                  else: {
                    $trim: {
                      input: {
                        $concat: [
                          { $ifNull: ["$userInfo.firstName", ""] },
                          " ",
                          { $ifNull: ["$userInfo.surname", ""] },
                        ],
                      },
                    },
                  },
                },
              },
              else: "Deleted User",
            },
          },
          avatar: {
            $cond: {
              if: { $ne: ["$userInfo", null] },
              then: {
                $cond: {
                  if: { $ne: ["$stylist", null] },
                  then: "$stylist.avatar",
                  else: { $ifNull: ["$userInfo.avatar", "/avatar.jpg"] },
                },
              },
              else: "/avatar.jpg",
            },
          },
          role: {
            $cond: {
              if: { $ne: ["$userInfo", null] },
              then: { $ifNull: ["$userInfo.role", "user"] },
              else: "user",
            },
          },
          lastMessage: 1,
          lastMessageTime: 1,
          unreadCount: 1,
          lastMessageSender: 1,
          isLastMessageFromMe: {
            $eq: ["$lastMessageSender", currentUserObjectId],
          },
          isUserActive: { $ne: ["$userInfo", null] },
          // Add extra info if available
          companyName: {
            $cond: {
              if: { $ne: ["$stylist", null] },
              then: "$stylist.companyName",
              else: null,
            },
          },
        },
      },
      {
        $sort: { lastMessageTime: -1 },
      },
    ]);

    // Ensure all chats have proper userName
    const cleanedChats = chats.map((chat) => {
      // If userName is empty or just spaces, create a fallback
      if (!chat.userName || chat.userName.trim() === "" || chat.userName === " ") {
        chat.userName = "User";
      }
      return chat;
    });

    res.status(StatusCodes.OK).json({
      success: true,
      data: cleanedChats,
    });
  } catch (error) {
    next(error);
  }
};
const updateMessage = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { read } = req.body;

    // Validation
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new CustomError.BadRequestError("Invalid message ID");
    }

    const message = await Message.findByIdAndUpdate(id, { read }, { new: true, session });

    if (!message) {
      throw new CustomError.NotFoundError("Message not found");
    }

    if (read) {
      // Only emit update if message is being marked as read
      emitMessageEvent(req.io, "messageUpdated", message, req.user.id);
    }

    await session.commitTransaction();
    res.status(StatusCodes.OK).json({
      success: true,
      data: message,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const deleteMessage = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    // Validation
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new CustomError.BadRequestError("Invalid message ID");
    }

    const message = await Message.findByIdAndDelete(id, { session });

    if (!message) {
      throw new CustomError.NotFoundError("Message not found");
    }

    // Emit the deleted message event to the receiver via Socket.IO
    emitMessageEvent(req.io, "messageDeleted", message);

    await session.commitTransaction();
    res.status(StatusCodes.OK).json({
      success: true,
      data: null,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
const uploadMessageImage = async (req, res, next) => {
  let tempFilePath = null;

  try {
    if (!req.files?.image) {
      throw new CustomError.BadRequestError("No image file uploaded");
    }

    const imageFile = req.files.image;
    tempFilePath = imageFile.tempFilePath;
    const fileBuffer = await fs.readFile(tempFilePath);

    // Upload the image asset
    const uploadResult = await writeClient.assets.upload("image", fileBuffer, {
      filename: imageFile.name,
      contentType: imageFile.mimetype,
    });

    // Create an imageStorage document referencing the asset
    const doc = await writeClient.create({
      _type: "messageImageStorage",
      image: {
        _type: "image",
        asset: {
          _type: "reference",
          _ref: uploadResult._id,
        },
      },
    });

    const imageUrl = `${uploadResult.url}?w=500&h=500&fit=crop`;

    res.status(StatusCodes.OK).json({
      success: true,
      imageUrl,
      documentId: doc._id,
      message: "Image uploaded and documented successfully",
    });
  } catch (error) {
    next(error);
  } finally {
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
      } catch (e) {
        console.error("Error deleting temp file:", e);
      }
    }
  }
};
module.exports = {
  sendMessage,
  getMessages,
  getChats,
  updateMessage,
  deleteMessage,
  startChat,
  uploadMessageImage,
  getUnreadMessagesCount,
  getUnreadCountByChat,
  markMessagesAsRead,
};

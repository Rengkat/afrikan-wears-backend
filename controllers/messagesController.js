const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const Message = require("../models/messageModel");
const mongoose = require("mongoose");
const fs = require("fs").promises;

const { emitMessageEvent, writeClient } = require("../utils");
const sendMessage = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { sender, receiver, content, image } = req.body;

    if (!sender || !receiver || !content) {
      throw new CustomError.BadRequestError("Please provide all fields");
    }

    // Use isValidObjectId for validation
    if (!mongoose.isValidObjectId(sender) || !mongoose.isValidObjectId(receiver)) {
      throw new CustomError.BadRequestError("Invalid sender or receiver ID");
    }

    if (sender === receiver) {
      throw new CustomError.BadRequestError("Cannot send message to yourself");
    }

    const message = await Message.create([{ sender, receiver, content, image }], { session });

    // Populate before emitting
    const populatedMessage = await Message.findById(message[0]._id)
      .populate("sender", "firstName surname avatar")
      .populate("receiver", "firstName surname avatar");

    // Emit the new message to the receiver via Socket.IO
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
    const { senderId, receiverId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Validation
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
        .populate("sender", "firstName surname avatar")
        .populate("receiver", "firstName surname avatar")
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

const getChats = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;

    // Validate currentUserId
    if (!mongoose.isValidObjectId(currentUserId)) {
      throw new CustomError.BadRequestError("Invalid user ID");
    }

    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);

    // Get distinct conversations where current user is either sender or receiver
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
        $project: {
          userId: "$_id",
          userName: {
            $cond: {
              if: { $ne: ["$userInfo", null] },
              then: {
                $cond: {
                  if: { $ne: ["$userInfo.name", null] },
                  then: "$userInfo.name",
                  else: {
                    $concat: [
                      { $ifNull: ["$userInfo.firstName", "Unknown"] },
                      " ",
                      { $ifNull: ["$userInfo.surname", "User"] },
                    ],
                  },
                },
              },
              else: "Deleted User",
            },
          },
          avatar: {
            $cond: {
              if: { $ne: ["$userInfo", null] },
              then: { $ifNull: ["$userInfo.avatar", "/avatar.jpg"] },
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
          isUserActive: { $ne: ["$userInfo", null] }, // Flag for deleted users
        },
      },
      {
        $sort: { lastMessageTime: -1 },
      },
    ]);

    res.status(StatusCodes.OK).json({
      success: true,
      data: chats,
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
  uploadMessageImage,
};

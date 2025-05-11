const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const Message = require("../models/messageModel");
const mongoose = require("mongoose");
const { emitMessageEvent } = require("../utils");

const sendMessage = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { sender, receiver, content } = req.body;

    if (!sender || !receiver || !content) {
      throw new CustomError.BadRequestError("Please provide all fields");
    }

    if (!mongoose.Types.ObjectId.isValid(sender) || !mongoose.Types.ObjectId.isValid(receiver)) {
      throw new CustomError.BadRequestError("Invalid sender or receiver ID");
    }

    if (sender === receiver) {
      throw new CustomError.BadRequestError("Cannot send message to yourself");
    }

    const message = await Message.create([{ sender, receiver, content }], { session });

    // Emit the new message to the receiver via Socket.IO
    emitMessageEvent(req.io, "newMessage", message[0]);

    await session.commitTransaction();
    res.status(StatusCodes.CREATED).json({
      success: true,
      data: message[0],
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
        .sort({ timestamp: -1 }) // Newest first
        .skip(skip)
        .limit(limit)
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

module.exports = {
  sendMessage,
  getMessages,
  updateMessage,
  deleteMessage,
};

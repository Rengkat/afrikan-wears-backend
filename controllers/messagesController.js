const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const Message = require("../models/messageModel");
const { emitMessageEvent } = require("../utils");
const sendMessage = async (req, res, next) => {
  const { sender, receiver, content } = req.body;

  if (!sender || !receiver || !content) {
    throw new CustomError.BadRequestError("Please all fields");
  }

  if (sender === receiver) {
    throw new CustomError.BadRequestError("Cannot send message to yourself");
  }

  try {
    const message = await Message.create({ sender, receiver, content });

    // Emit the new message to the receiver via Socket.IO
    emitMessageEvent(req.io, "newMessage", message);

    res.status(StatusCodes.CREATED).json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
};
const getMessages = async (req, res, next) => {
  const { senderId, receiverId } = req.params;

  // Validation
  if (!mongoose.Types.ObjectId.isValid(senderId) || !mongoose.Types.ObjectId.isValid(receiverId)) {
    throw new CustomError.BadRequestError("Invalid sender or receiver id");
  }

  try {
    const messages = await Message.find({
      $or: [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId },
      ],
    }).sort({ timestamp: 1 });

    res.status(StatusCodes.OK).json({ success: true, data: messages });
  } catch (error) {
    next(error);
  }
};
const updateMessage = async (req, res, next) => {
  const { id } = req.params;
  const { read } = req.body;

  // Validation
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new CustomError.BadRequestError("Invalid message ID");
  }

  try {
    const message = await Message.findByIdAndUpdate(id, { read }, { new: true });

    if (!message) {
      throw new CustomError.NotFoundError("Message not found");
    }

    // Emit the updated message to the receiver via Socket.IO
    emitMessageEvent(req.io, "messageUpdated", message);

    res.status(StatusCodes.OK).json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
};
const deleteMessage = async (req, res, next) => {
  const { id } = req.params;

  // Validation
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new CustomError.BadRequestError("Invalid message ID");
  }

  try {
    const message = await Message.findByIdAndDelete(id);

    if (!message) {
      throw new CustomError.NotFoundError("Message not found");
    }

    // Emit the deleted message event to the receiver via Socket.IO
    emitMessageEvent(req.io, "messageDeleted", message);

    res.status(StatusCodes.OK).json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendMessage,
  getMessages,
  updateMessage,
  deleteMessage,
};

const Notification = require("../models/notificationModel");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");

const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const notifications = await Notification.find({ recipient: req.user.id })
      .sort({ createdAt: -1 })

      .skip(skip)
      .limit(limit);

    res.status(StatusCodes.OK).json({
      success: true,
      count: notifications.length,
      notifications,
    });
  } catch (error) {
    next(error);
  }
};

const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user.id },
      { read: true },
      { new: true }
    );

    if (!notification) {
      throw new CustomError.NotFoundError("Notification not found");
    }

    res.status(StatusCodes.OK).json({
      success: true,
      notification,
    });
  } catch (error) {
    next(error);
  }
};

const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipient: req.user.id,
      read: false,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      count,
    });
  } catch (error) {
    next(error);
  }
};

const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: req.user.id,
    });

    if (!notification) {
      throw new CustomError.NotFoundError("Notification not found");
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  getUnreadCount,
  deleteNotification,
};

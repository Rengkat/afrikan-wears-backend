// models/userStatusModel.js
const mongoose = require("mongoose");

const userStatusSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    socketId: {
      type: String,
    },
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },
    deliveredAt: Date,
    readAt: Date,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("UserStatus", userStatusSchema);

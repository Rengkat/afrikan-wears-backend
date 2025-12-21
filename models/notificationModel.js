const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "recipientModel",
    },
    recipientModel: {
      type: String,
      required: true,
      enum: ["User", "Stylist", "Admin"],
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    type: {
      type: String,
      required: true,
      enum: [
        "product_approval_request",
        "product_approved",
        "product_rejected",
        "new_order",
        "order_status_update",
        "message_received",
        "credit_wallet",
        "debit_wallet",
        "system_alert",
        "stylist_verification_request",
        "stylist_approved",
        "stylist_rejected",
        "stylist_suspended",
        "stylist_activated",
        "order_cancelled",
        "order_delivered",
      ],
    },
    message: {
      type: String,
      required: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
    },
    read: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model("Notification", notificationSchema);

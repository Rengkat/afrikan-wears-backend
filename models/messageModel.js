const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Sender is required"],
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Receiver is required"],
    },
    content: {
      type: String,
      // Make content required only if image is not provided
      required: function () {
        return !this.image;
      },
      trim: true,
    },
    image: {
      type: String,
      trim: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// Ensure at least content or image is provided
messageSchema.pre("validate", function (next) {
  if (!this.content && !this.image) {
    next(new Error("Either content or image must be provided"));
  } else {
    next();
  }
});

// Index for faster queries
messageSchema.index({ sender: 1, receiver: 1, timestamp: -1 });
messageSchema.index({ receiver: 1, read: 1 });

module.exports = mongoose.model("Message", messageSchema);

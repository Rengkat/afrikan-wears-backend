const mongoose = require("mongoose");

const TokenSchema = new mongoose.Schema(
  {
    refreshToken: { type: String, required: true },
    user: { type: mongoose.Schema.ObjectId, ref: "User", required: true, index: true },
    deviceInfo: {
      ip: { type: String },
      userAgent: { type: String },
      deviceId: { type: String },
    },
    isValid: { type: Boolean, default: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }, //auto delete expired
  },
  { timestamps: true },
);
TokenSchema.index({ user: 1, isValid: 1 }); // Index on user field for faster queries
TokenSchema.index({ refreshToken: 1 }); // TTL index to auto-delete expired tokens
module.exports = mongoose.model("Token", TokenSchema);

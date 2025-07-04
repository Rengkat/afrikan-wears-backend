const mongoose = require("mongoose");
const { Schema } = mongoose;

const TransactionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    previousBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    currentBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "reversed"],
      default: "completed",
    },
    metadata: {
      type: Object,
    },
  },
  { timestamps: true }
);
TransactionSchema.index({ user: 1 });
TransactionSchema.index({ createdAt: -1 });
TransactionSchema.index({ type: 1 });
TransactionSchema.index({ status: 1 });
module.exports = mongoose.model("Transaction", TransactionSchema);

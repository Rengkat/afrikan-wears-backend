const mongoose = require("mongoose");
const { Schema } = mongoose;

const orderItemSchema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    priceAtPurchase: {
      type: Number,
      required: true,
    },
    stylist: {
      type: Schema.Types.ObjectId,
      ref: "Stylist",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "shipped", "delivered", "cancelled", "returned"],
      default: "pending",
    },
  },
  { _id: false }
);

const paymentInfoSchema = new Schema(
  {
    paymentMethod: {
      type: String,
      enum: ["credit_card", "paypal", "bank_transfer", "cash_on_delivery"],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
    },
    transactionId: String,
    amountPaid: {
      type: Number,
      required: true,
    },
    paymentDate: Date,
  },
  { _id: false }
);

const shippingAddressSchema = new Schema(
  {
    street: {
      type: String,
      required: true,
    },
    city: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      required: true,
    },
    country: {
      type: String,
      required: true,
    },
    postalCode: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    customer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    orderItems: [orderItemSchema],
    shippingAddress: shippingAddressSchema,
    paymentInfo: paymentInfoSchema,
    itemsPrice: {
      type: Number,
      required: true,
      default: 0,
    },
    taxPrice: {
      type: Number,
      required: true,
      default: 0,
    },
    shippingPrice: {
      type: Number,
      required: true,
      default: 0,
    },
    totalPrice: {
      type: Number,
      required: true,
      default: 0,
    },
    orderStatus: {
      type: String,
      enum: ["pending", "processing", "shipped", "delivered", "cancelled"],
      default: "pending",
    },
    deliveredAt: Date,
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

// Calculate total price before saving
orderSchema.pre("save", async function (next) {
  if (this.isModified("orderItems")) {
    this.itemsPrice = this.orderItems.reduce(
      (total, item) => total + item.priceAtPurchase * item.quantity,
      0
    );
    this.totalPrice = this.itemsPrice + this.taxPrice + this.shippingPrice;
  }
  next();
});

// Add virtual for order duration (in days)
orderSchema.virtual("orderDuration").get(function () {
  if (!this.deliveredAt) return null;
  return Math.ceil((this.deliveredAt - this.createdAt) / (1000 * 60 * 60 * 24));
});

// Indexes for better query performance
orderSchema.index({ customer: 1 });
orderSchema.index({ "orderItems.stylist": 1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ createdAt: -1 });

// Static methods
orderSchema.statics.getOrdersByCustomer = function (customerId, page = 1, limit = 10) {
  return this.find({ customer: customerId })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate("customer", "name email")
    .populate("orderItems.product", "name mainImage")
    .populate("orderItems.stylist", "name");
};

orderSchema.statics.getOrdersByStylist = function (stylistId, page = 1, limit = 10) {
  return this.find({ "orderItems.stylist": stylistId })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate("customer", "name email")
    .populate("orderItems.product", "name mainImage");
};

// Instance methods
orderSchema.methods.updateItemStatus = async function (itemIndex, newStatus) {
  if (itemIndex >= 0 && itemIndex < this.orderItems.length) {
    this.orderItems[itemIndex].status = newStatus;
    await this.save();
    return this;
  }
  throw new Error("Invalid item index");
};

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;

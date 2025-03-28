const mongoose = require("mongoose");

const CartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: [true, "Product ID is required"],
  },
  quantity: {
    type: Number,
    required: [true, "Quantity is required"],
    min: [1, "Quantity cannot be less than 1"],
  },
  price: {
    type: Number,
    required: [true, "Price is required"],
    min: [0, "Price cannot be negative"],
  },
});

const CartSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      unique: true,
    },
    items: [CartItemSchema],
    totalPrice: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Total price cannot be negative"],
    },
    totalItems: {
      type: Number,
      required: true,
      default: 0, // Default total items is 0
      min: [0, "Total items cannot be negative"],
    },
  },
  {
    timestamps: true, // Automatically adds `createdAt` and `updatedAt` fields
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Middleware to calculate totalPrice and totalItems before saving
CartSchema.pre("save", function (next) {
  let totalPrice = 0;
  let totalItems = 0;

  this.items.forEach((item) => {
    totalPrice += item.quantity * item.price;
    totalItems += item.quantity;
  });

  // Set the calculated values in the model
  this.totalPrice = totalPrice;
  this.totalItems = totalItems;

  next();
});

// Middleware to calculate totalPrice and totalItems before updating
CartSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate(); // Get the update object
  if (update.$set && update.$set.items) {
    let totalPrice = 0;
    let totalItems = 0;

    update.$set.items.forEach((item) => {
      totalPrice += item.quantity * item.price;
      totalItems += item.quantity;
    });

    // Set the calculated values in the update object
    update.$set.totalPrice = totalPrice;
    update.$set.totalItems = totalItems;
  }
  next();
});

module.exports = mongoose.model("Cart", CartSchema);

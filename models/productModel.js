const mongoose = require("mongoose");

const ProductSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Provide product name"],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, "Provide product price"],
      min: [0, "Price cannot be negative"],
    },
    image: {
      type: String,
      required: [true, "Provide product image URL"],
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: [true, "Provide product brand"],
    },
    sku: {
      type: String,
      required: [true, "Provide product SKU"],
      unique: true,
    },
    description: {
      type: String,
      required: [true, "Provide product description"],
      trim: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Provide product category"],
    },
    stock: {
      type: Number,
      required: [true, "Provide product stock quantity"],
      min: [0, "Stock cannot be negative"],
    },
    rating: {
      type: Number,
      default: 0,
      min: [0, "Rating cannot be less than 0"],
      max: [5, "Rating cannot be more than 5"],
    },
    reviews: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: [true, "Provide user ID for the review"],
        },
        rating: {
          type: Number,
          required: [true, "Provide review rating"],
          min: [0, "Rating cannot be less than 0"],
          max: [5, "Rating cannot be more than 5"],
        },
        comment: {
          type: String,
          trim: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    featured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Product", ProductSchema);

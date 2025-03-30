const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Provide product name"],
      trim: true,
      maxlength: [100, "Product name cannot exceed 100 characters"],
    },
    price: {
      type: Number,
      required: [true, "Provide product price"],
      min: [0, "Price cannot be negative"],
      set: (v) => Math.round(v * 100) / 100, // Round to 2 decimal places
    },
    images: [
      // Changed to array for multiple images
      {
        type: String,
        required: [true, "Provide at least one image URL"],
      },
    ],
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: [true, "Provide product brand"],
    },
    sku: {
      type: String,
      required: [true, "Provide product SKU"],
      unique: true,
      uppercase: true, // Ensure SKU is stored in uppercase
    },
    description: {
      type: String,
      required: [true, "Provide product description"],
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
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
      set: (v) => Math.round(v * 10) / 10, // Round to 1 decimal place
    },
    reviews: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        rating: {
          type: Number,
          required: true,
          min: 0,
          max: 5,
        },
        comment: {
          type: String,
          trim: true,
          maxlength: 500,
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
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      index: true,
    },
    attributes: {
      // For product variants (size, color, etc.)
      type: Map,
      of: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Auto-generate slug
ProductSchema.pre("save", function (next) {
  if (!this.slug) {
    this.slug = `${this.name.toLowerCase().replace(/\s+/g, "-")}-${this.sku.toLowerCase()}`;
  }
  next();
});

// Virtual for average rating (calculated on-the-fly)
ProductSchema.virtual("averageRating").get(function () {
  if (this.reviews.length === 0) return 0;
  const sum = this.reviews.reduce((acc, review) => acc + review.rating, 0);
  return sum / this.reviews.length;
});

module.exports = mongoose.model("Product", ProductSchema);

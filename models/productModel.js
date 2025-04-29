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
    mainImage: {
      type: String,
      required: [true, "Please provide product image URL"],
      validate: {
        validator: function (v) {
          return /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i.test(v);
        },
        message: (props) => `${props.value} is not a valid URL!`,
      },
    },
    subImages: {
      type: [String],
      validate: {
        validator: function (v) {
          return v.every((url) => /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i.test(url));
        },
        message: (props) => `Invalid URL found in subImages!`,
      },
    },
    sku: {
      type: String,
      required: [true, "Provide product SKU"],
      unique: true,
      uppercase: true,
    },
    description: {
      type: String,
      required: [true, "Provide product description"],
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    category: {
      type: String,
      enum: ["all", "men corporate", "women corporate", "men native", "female native"],
      required: [true, "Provide product category"],
    },
    size: {
      type: String,
      enum: ["normal", "xl", "xxl"],
      default: "normal",
    },
    stylist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Stylist",
      required: true,
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
    reviews: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          rating: { type: Number, required: true, min: 0, max: 5 },
          comment: { type: String, trim: true, maxlength: 500 },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    featured: {
      type: Boolean,
      default: false,
    },
    isAdminApproved: {
      type: Boolean,
      default: false,
    },

    createdBy: {
      type: String,
      enum: ["admin", "stylist"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: [500, "Rejection reason cannot exceed 500 characters"],
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
  if (!this.reviews || this.reviews.length === 0) return 0; // Handle undefined/null
  const sum = this.reviews.reduce((acc, review) => acc + review.rating, 0);
  return Math.round((sum / this.reviews.length) * 10) / 10; // Round to 1 decimal
});
ProductSchema.index({ price: 1 });
ProductSchema.index({ rating: -1 });
ProductSchema.index({ featured: 1 });
ProductSchema.index({ brand: 1 });
ProductSchema.index({ category: 1 });

module.exports = mongoose.model("Product", ProductSchema);

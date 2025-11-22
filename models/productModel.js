const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      maxlength: [1000, "Description too long"],
    },
    productDetails: String,
    materials: String,
    careInstructions: String,
    deliveryInfo: String,

    price: {
      type: Number,
      required: true,
      min: 0,
    },
    originalPrice: Number,
    minPrice: Number,
    maxPrice: Number,

    // Media
    mainImage: {
      type: String,
      required: true,
      validate: {
        validator: (v) => /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i.test(v),
        message: (props) => `${props.value} is not a valid URL!`,
      },
    },
    subImages: [
      {
        type: String,
        validate: {
          validator: (v) => /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i.test(v),
          message: "Invalid image URL",
        },
      },
    ],

    // Variants
    sizes: [String],
    colors: [String],
    attributes: {
      type: Map,
      of: String,
    },

    // Relationships
    stylist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Stylist",
      required: true,
    },
    stylistName: String,

    // Reviews & Ratings
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviews: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        name: String,
        rating: { type: Number, required: true, min: 0, max: 5 },
        comment: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    reviewCount: {
      type: Number,
      default: 0,
    },

    // Flags
    isBestSeller: Boolean,
    isNewProduct: Boolean,
    featured: Boolean,
    isAdminApproved: {
      type: Boolean,
      default: false,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rejectionReason: String,

    // Inventory
    stock: {
      type: Number,
      required: true,
      min: 0,
    },
    sku: {
      type: String,
      unique: true,
      uppercase: true,
    },

    category: {
      type: String,
      enum: ["men", "women", "unisex",'material'],
      required: true,
    },
    type: {
      type: String,
      enum: ["native", "corporate", "casual", "traditional"],
      required: true,
    },
    tags: [String],

    // Status
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
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
    this.slug = this.name.toLowerCase().replace(/\s+/g, "-");
  }
  next();
});

// Indexes
ProductSchema.index({ name: "text", description: "text" });
ProductSchema.index({ price: 1 });
ProductSchema.index({ rating: -1 });
ProductSchema.index({ isBestSeller: 1 });
ProductSchema.index({ isNew: 1 });
ProductSchema.index({ stylist: 1 });

module.exports = mongoose.model("Product", ProductSchema);

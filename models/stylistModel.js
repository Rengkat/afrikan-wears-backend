const mongoose = require("mongoose");

const StylistSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      unique: true,
      maxlength: [100, "Company name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    specialty: {
      type: String,
      trim: true,
    },
    experience: {
      type: String,
      default: "0 years",
    },
    rating: {
      type: Number,
      default: 0,
      min: [0, "Rating cannot be negative"],
      max: [5, "Rating cannot exceed 5"],
    },
    reviews: {
      type: Number,
      default: 0,
    },
    services: {
      type: [String],
    },

    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    website: {
      type: String,
      trim: true,
    },
    socialMedia: {
      twitter: { type: String, trim: true },
      facebook: { type: String, trim: true },
      instagram: { type: String, trim: true },
      pinterest: { type: String, trim: true },
    },

    // Location (expanded for flexibility)
    location: {
      state: { type: String },
      lga: { type: String },
      address: { type: String },
      branches: { type: Number, default: 1 },
    },

    // Media
    avatar: {
      type: String, // URL to profile image
      default: "/default-avatar.jpg",
    },
    banner: {
      type: String, // URL to banner image
      default: "/default-banner.jpg",
    },
    portfolio: [
      {
        image: { type: String, required: true }, 
        category: { type: String, required: true },
      },
    ],

    // References
    owner: {
      type: mongoose.Types.ObjectId,
      ref: "User",
      // required: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
    },

    isCompanyVerified: {
      type: Boolean,
      default: false,
    },
    cacCertificateNumber: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    verificationDate: {
      type: Date,
    },
    verifiedBy: {
      type: mongoose.Types.ObjectId,
      ref: "User",
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    documents: {
      cacCertificate: { type: String },
      businessRegistration: { type: String },
      taxCertificate: { type: String },
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Auto-generate slug before saving
StylistSchema.pre("save", function (next) {
  if (!this.slug) {
    this.slug = this.companyName.toLowerCase().replace(/\s+/g, "-");
  }
  next();
});

// Virtual for checking if stylist can add products
StylistSchema.virtual("canAddProducts").get(function () {
  return this.isCompanyVerified && this.verificationStatus === "verified";
});

module.exports = mongoose.model("Stylist", StylistSchema);

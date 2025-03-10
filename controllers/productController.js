const mongoose = require("mongoose");
const ProductSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Provide product name"],
    },
    price: {
      type: Number,
      required: [true, "Provide product price"],
    },
    image: {
      type: String,
      required: [true, "Provide product image url"],
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: [true, "Provide product brand"],
    },
    sku: {
      type: String,
      required: [true, "Provide product sku"],
    },
  },
  {
    timestamps: true,
  }
);

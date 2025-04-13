const Product = require("../models/productModel");
const CustomError = require("../errors");
const { StatusCodes } = require("http-status-codes");
const generateSKU = require("../utils/skuGenerator");
const { writeClient } = require("../utils");
const fs = require("fs").promises;
const path = require("path");
const mongoose = require("mongoose");
const { getFromCache, setInCache, clearCache } = require("../utils/redisClient");

const addProduct = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      name,
      price,
      mainImage,
      subImages,
      stylist,
      category,
      description,
      stock,
      rating,
      featured,
      attributes,
    } = req.body;

    if (!name || !price || !category || !stylist || !mongoose.Types.ObjectId.isValid(stylist)) {
      throw new CustomError.BadRequestError("Provide valid name, price, category and stylist ID");
    }

    // Generate a unique SKU
    const sku = generateSKU(category, name);

    // Check if SKU already exists
    const existingProduct = await Product.findOne({ sku }).session(session);
    if (existingProduct) {
      throw new CustomError.BadRequestError("Product with this SKU already exists");
    }

    const product = await Product.create(
      [
        {
          name,
          price,
          mainImage,
          subImages,
          stylist,
          sku,
          category,
          description,
          stock,
          rating,
          featured,
          attributes,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    res.status(StatusCodes.CREATED).json({
      success: true,
      product: product[0],
      message: "Product added successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const getAllProducts = async (req, res, next) => {
  try {
    const { stylist, page = 1, name, limit = 10, category, featured } = req.query;
    const query = {};
    // Apply filters if provided
    if (stylist) {
      if (!mongoose.Types.ObjectId.isValid(stylist)) {
        throw new CustomError.BadRequestError("Invalid stylist ID");
      }
      query.stylist = stylist;
    }
    if (name) query.name = { $regex: name, $options: "i" };
    if (category) query.category = category;
    if (featured) query.featured = featured === "true";

    // Pagination
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      Product.find(query)
        .select("name price mainImage rating category featured")
        .populate("stylist", "name")
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);

    res.status(StatusCodes.OK).json({
      success: true,
      count: products.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      products,
    });
  } catch (error) {
    next(error);
  }
};

const getDetailProduct = async (req, res, next) => {
  try {
    const { productId: id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    const product = await Product.findById(id)
      .populate("stylist", "name location")
      .populate("reviews.user", "name avatar");

    if (!product) {
      throw new CustomError.NotFoundError(`Product with ID ${id} not found`);
    }

    res.status(StatusCodes.OK).json({
      success: true,
      product,
    });
  } catch (error) {
    next(error);
  }
};

const updateProduct = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId: id } = req.params;
    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    const product = await Product.findById(id).session(session);
    if (!product) {
      throw new CustomError.NotFoundError(`Product with ID ${id} not found`);
    }

    // Prevent SKU updates
    if (updateData.sku && updateData.sku !== product.sku) {
      throw new CustomError.BadRequestError("SKU cannot be changed");
    }

    // Update fields
    const allowedUpdates = [
      "name",
      "price",
      "mainImage",
      "subImages",
      "description",
      "category",
      "stock",
      "rating",
      "featured",
      "attributes",
    ];

    allowedUpdates.forEach((field) => {
      if (updateData[field] !== undefined) {
        product[field] = updateData[field];
      }
    });

    await product.save({ session });
    await session.commitTransaction();

    res.status(StatusCodes.OK).json({
      success: true,
      product,
      message: "Product updated successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const deleteProduct = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId: id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    // Check if product has any reviews
    const product = await Product.findById(id).session(session);
    if (!product) {
      throw new CustomError.NotFoundError(`Product with ID ${id} not found`);
    }

    if (product.reviews.length > 0) {
      throw new CustomError.BadRequestError("Cannot delete product with reviews");
    }

    await Product.findByIdAndDelete(id).session(session);
    await session.commitTransaction();

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const uploadProductImage = async (req, res, next) => {
  let tempFilePath = null;

  try {
    if (!req.files?.image) {
      throw new CustomError.BadRequestError("No image file uploaded");
    }

    const imageFile = req.files.image;
    tempFilePath = imageFile.tempFilePath;
    const fileBuffer = await fs.readFile(tempFilePath);

    // Upload the image asset
    const uploadResult = await writeClient.assets.upload("image", fileBuffer, {
      filename: imageFile.name,
      contentType: imageFile.mimetype,
    });

    // Create an imageStorage document referencing the asset
    const doc = await writeClient.create({
      _type: "imageStorage",
      image: {
        _type: "image",
        asset: {
          _type: "reference",
          _ref: uploadResult._id,
        },
      },
    });

    const imageUrl = `${uploadResult.url}?w=500&h=500&fit=crop`;

    res.status(StatusCodes.OK).json({
      success: true,
      imageUrl,
      documentId: doc._id,
      message: "Image uploaded and documented successfully",
    });
  } catch (error) {
    next(error);
  } finally {
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
      } catch (e) {
        console.error("Error deleting temp file:", e);
      }
    }
  }
};

const addReview = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId } = req.params;
    const { comment, rating } = req.body;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    if (!rating || rating < 0 || rating > 5) {
      throw new CustomError.BadRequestError("Rating must be between 0 and 5");
    }

    const product = await Product.findById(productId).session(session);
    if (!product) {
      throw new CustomError.NotFoundError("Product not found");
    }

    const existingReview = product.reviews.find(
      (review) => review.user.toString() === userId.toString()
    );
    if (existingReview) {
      throw new CustomError.BadRequestError("You already reviewed this product");
    }

    product.reviews.push({
      user: userId,
      rating,
      comment: comment || "",
    });

    await product.save({ session });
    await session.commitTransaction();

    res.status(StatusCodes.CREATED).json({
      success: true,
      data: product,
      averageRating: product.averageRating,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const updateReview = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId, reviewId } = req.params;
    const { comment, rating } = req.body;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    if (rating && (rating < 0 || rating > 5)) {
      throw new CustomError.BadRequestError("Rating must be between 0 and 5");
    }

    const product = await Product.findById(productId).session(session);
    if (!product) {
      throw new CustomError.NotFoundError("Product not found");
    }

    const reviewIndex = product.reviews.findIndex(
      (review) => review._id.toString() === reviewId && review.user.toString() === userId.toString()
    );

    if (reviewIndex === -1) {
      throw new CustomError.NotFoundError("Review not found or unauthorized");
    }

    // Update the review
    if (rating !== undefined) product.reviews[reviewIndex].rating = rating;
    if (comment !== undefined) product.reviews[reviewIndex].comment = comment;

    await product.save({ session });
    await session.commitTransaction();

    res.status(StatusCodes.OK).json({
      success: true,
      data: product,
      averageRating: product.averageRating,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

module.exports = {
  addProduct,
  getAllProducts,
  getDetailProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  addReview,
  updateReview,
};

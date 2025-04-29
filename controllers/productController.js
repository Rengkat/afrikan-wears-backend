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
      category,
      description,
      stock,
      rating,
      featured,
      attributes,
    } = req.body;

    // Get user info from auth middleware
    const { role, company, userId } = req.user;

    // Validate required fields
    if (!name || !price || !category || !mainImage || !description || stock === undefined) {
      throw new CustomError.BadRequestError("Please provide all required product details");
    }

    // For stylists, ensure they can only add products for themselves
    const stylistId = role === "stylist" ? company : req.body.stylist;

    if (!stylistId || !mongoose.Types.ObjectId.isValid(stylistId)) {
      throw new CustomError.BadRequestError("Provide valid stylist ID");
    }

    // Generate a unique SKU
    const sku = generateSKU(category, name);

    // Check if SKU already exists
    const existingProduct = await Product.findOne({ sku }).session(session);
    if (existingProduct) {
      throw new CustomError.BadRequestError("Product with this SKU already exists");
    }

    // Create product
    const product = await Product.create(
      [
        {
          name,
          price,
          mainImage,
          subImages: subImages || [],
          stylist: stylistId,
          sku,
          category,
          description,
          stock,
          rating: role === "admin" ? rating || 0 : 0,
          featured: role === "admin" ? featured || false : false,
          attributes: attributes || {},
          isAdminApproved: role === "admin",
          createdBy: role,
          status: role === "admin" ? "approved" : "pending",
        },
      ],
      { session }
    );

    await session.commitTransaction();

    // Clear products cache
    await clearCache("products:*");

    // Optionally: Send notification to admin if product needs approval
    // if (role === "stylist") {
    //   await notifyAdminsAboutNewProduct(product[0]);
    // }

    res.status(StatusCodes.CREATED).json({
      success: true,
      product: product[0],
      message: `Product added successfully${
        role === "stylist" ? " and awaiting admin approval" : ""
      }`,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
const verifyProduct = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId } = req.params;
    const { action } = req.body;
    const { userId } = req.user;

    if (!["approve", "reject"].includes(action)) {
      throw new CustomError.BadRequestError("Invalid action. Use 'approve' or 'reject'");
    }

    const product = await Product.findById(productId).session(session);
    if (!product) {
      throw new CustomError.NotFoundError("Product not found");
    }

    // Check if product needs verification
    if (product.createdBy !== "stylist" || product.status !== "pending") {
      throw new CustomError.BadRequestError("This product does not require verification");
    }

    if (action === "approve") {
      product.isAdminApproved = true;
      product.status = "approved";
      product.approvedBy = userId;
      product.rejectionReason = undefined;
    } else {
      const { reason } = req.body;
      if (!reason || reason.trim().length < 10) {
        throw new CustomError.BadRequestError(
          "Please provide a valid rejection reason (min 10 chars)"
        );
      }

      product.isAdminApproved = false;
      product.status = "rejected";
      product.rejectionReason = reason;
      product.approvedBy = userId;
    }

    await product.save({ session });
    await session.commitTransaction();

    // Clear cache
    await clearCache("products:*");

    // Notify stylist about the decision
    // await notifyStylistAboutProductStatus(product, action);

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Product ${action === "approve" ? "approved" : "rejected"} successfully`,
      product,
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
    const { role, company, userId } = req.user;
    const { stylist, page = 1, name, limit = 10, category, featured, status } = req.query;

    // Create a unique cache key based on all parameters
    const cacheKey = `products:${role}:${userId}:${stylist || "all"}:${page}:${limit}:${
      name || ""
    }:${category || ""}:${featured || ""}:${status || ""}`;

    // Try to get data from cache first
    const cachedData = await getFromCache(cacheKey);
    if (cachedData) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        ...cachedData,
      });
    }

    // Base query object
    const query = {};

    // Role-based visibility rules
    if (role === "customer") {
      query.status = "approved";
    } else if (role === "stylist") {
      query.$or = [
        { status: "approved" },
        { stylist: company, createdBy: "stylist" }, // Their own products
      ];
    }
    // Admins can see all products by default

    // Additional filters
    if (stylist) {
      if (!mongoose.Types.ObjectId.isValid(stylist)) {
        throw new CustomError.BadRequestError("Invalid stylist ID");
      }
      query.stylist = stylist;
    }
    if (name) query.name = { $regex: name, $options: "i" };
    if (category) query.category = category;
    if (featured) query.featured = featured === "true";

    // Status filter (especially useful for admin)
    if (status && ["pending", "approved", "rejected"].includes(status)) {
      // For stylists, we need to ensure they can only filter their own pending/rejected products
      if (role === "stylist" && status !== "approved") {
        query.$and = [{ status }, { stylist: company, createdBy: "stylist" }];
      } else {
        query.status = status;
      }
    }

    // Pagination
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      Product.find(query)
        .select("name price mainImage rating category featured status createdBy")
        .populate("stylist", "name email")
        .populate("approvedBy", "name")
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);

    const responseData = {
      count: products.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      products,
    };

    // Cache the response for 1 hour (3600 seconds)
    await setInCache(cacheKey, responseData, 3600);

    res.status(StatusCodes.OK).json({
      success: true,
      fromCache: false,
      ...responseData,
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

    const cacheKey = `product:${id}`;

    // Try to get data from cache first
    const cachedProduct = await getFromCache(cacheKey);
    if (cachedProduct) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        product: cachedProduct,
      });
    }

    const product = await Product.findById(id)
      .populate("stylist", "name location")
      .populate("reviews.user", "name avatar");

    if (!product) {
      throw new CustomError.NotFoundError(`Product with ID ${id} not found`);
    }

    // Cache the product for 1 hour (3600 seconds)
    await setInCache(cacheKey, product.toObject());

    res.status(StatusCodes.OK).json({
      success: true,
      fromCache: false,
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
    const { role, company, userId } = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    const product = await Product.findById(id).session(session);
    if (!product) {
      throw new CustomError.NotFoundError(`Product with ID ${id} not found`);
    }

    // Role-based update restrictions
    if (role === "stylist") {
      // Stylists can only update their own pending products
      if (product.stylist.toString() !== company.toString() || product.status !== "pending") {
        throw new CustomError.UnauthorizedError("You can only update your own pending products");
      }
    } else if (role === "customer") {
      throw new CustomError.UnauthorizedError("Customers cannot update products");
    }

    // Prevent SKU updates
    if (updateData.sku && updateData.sku !== product.sku) {
      throw new CustomError.BadRequestError("SKU cannot be changed");
    }

    // Admin-specific field restrictions
    if (role !== "admin") {
      delete updateData.featured;
      delete updateData.isAdminApproved;
      delete updateData.status;
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
      "status", // Only admins can update this
      "rejectionReason", // Only admins can update this
    ];

    allowedUpdates.forEach((field) => {
      if (updateData[field] !== undefined) {
        product[field] = updateData[field];
      }
    });

    // If admin is updating status, track who approved/rejected
    if (role === "admin" && updateData.status) {
      product.approvedBy = userId;
      if (updateData.status === "approved") {
        product.isAdminApproved = true;
      }
    }

    await product.save({ session });
    await session.commitTransaction();

    // Clear cache and notify relevant parties
    await Promise.all([clearCache(`product:${id}`), clearCache("products:*")]);

    // Notify stylist if status changed
    if (updateData.status && product.createdBy === "stylist") {
      const stylist = await User.findById(product.stylist);
      emitProductNotification(io, product, updateData.status, req.user);
    }

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
    // Clear both the specific product cache and the products list cache
    await Promise.all([clearCache(`product:${id}`), clearCache("products:*")]);
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
    // Clear the product cache as reviews affect the product data
    await clearCache(`product:${productId}`);
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
    // Clear the product cache as reviews affect the product data
    await clearCache(`product:${productId}`);
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
  verifyProduct,
};

const Product = require("../models/productModel");
const CustomError = require("../errors");
const Order = require("../models/orderModel");
const { StatusCodes } = require("http-status-codes");
const generateSKU = require("../utils/skuGenerator");
const { writeClient } = require("../utils");
const fs = require("fs").promises;
const path = require("path");
const mongoose = require("mongoose");
const { getFromCache, setInCache, clearCache } = require("../utils/redisClient");
const Stylist = require("../models/stylistModel");
const { emitNotification } = require("../utils/socket");

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
      type,
    } = req.body;

    // Get user info from auth middleware
    const { role, company, userId } = req.user;

    // Validate required fields
    if (
      !name ||
      !price ||
      !category ||
      !type ||
      !mainImage ||
      !description ||
      stock === undefined
    ) {
      throw new CustomError.BadRequestError("Please provide all required product details");
    }

    // For stylists, ensure they can only add products for themselves
    const stylistId = role === "stylist" ? company : req.body.stylist;

    if (!stylistId || !mongoose.Types.ObjectId.isValid(stylistId)) {
      throw new CustomError.BadRequestError("Provide valid stylist ID");
    }

    // VERIFICATION CHECK
    const stylistCompany = await Stylist.findById(stylistId).session(session);
    if (!stylistCompany) {
      throw new CustomError.NotFoundError("Stylist company not found");
    }

    if (role === "stylist" && !stylistCompany.canAddProducts) {
      throw new CustomError.BadRequestError(
        "Your company must be verified by admin before you can add products. Current status: " +
          stylistCompany.verificationStatus
      );
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
          type,
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

    // Clear cache
    await clearCache("products:*");

    // Notification for stylist-created products
    if (role === "stylist") {
      const stylistCompany = await Stylist.findById(company).select("name").lean();

      const notificationPayload = {
        type: "product_approval_request",
        message: `New product "${product[0].name}" requires approval`,
        data: {
          productId: product[0]._id,
          productName: product[0].name,
          stylistId: stylistId,
          stylistName: stylistCompany?.name || "Stylist",
          createdAt: new Date(),
        },
      };
      emitNotification(req.io, "newNotification", notificationPayload, "admin_room");
    }
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
      // Notify stylist
      if (product.stylist) {
        const notificationPayload = {
          type: "product_approved",
          message: `Your product "${product.name}" was approved`,
          data: {
            productId: product._id,
            productName: product.name,
            approvedAt: new Date(),
          },
        };
        emitNotification(
          req.io,
          "newNotification",
          notificationPayload,
          product.stylist.toString()
        );
      }
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
      // Notify stylist with reason
      if (product.stylist) {
        const notificationPayload = {
          type: "product_rejected",
          message: `Your product "${product.name}" was rejected`,
          data: {
            productId: product._id,
            productName: product.name,
            rejectionReason: reason,
            rejectedAt: new Date(),
          },
        };
        emitNotification(
          req.io,
          "newNotification",
          notificationPayload,
          product.stylist.toString()
        );
      }
    }

    await product.save({ session });
    await session.commitTransaction();

    // Clear cache
    await clearCache("products:*");

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
    const { stylist, page = 1, name, limit = 10, category, type, featured, status } = req.query;

    // Create a unique cache key based on all parameters
    const cacheKey = `products:${role}:${userId}:${stylist || "all"}:${page}:${limit}:${
      name || ""
    }:${category || ""}:${type || ""}:${featured || ""}:${status || ""}`;

    // get data from cache first
    const cachedData = await getFromCache(cacheKey);
    if (cachedData) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        ...cachedData,
      });
    }

    const query = {};

    // Role-based visibility rules- for users, only approved
    if (role === "user") {
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
    if (type) query.type = type;
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
        .populate("stylist", "name")
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
const getMyProducts = async (req, res, next) => {
  try {
    const { role, company, userId } = req.user;
    const { page = 1, limit = 10, status, category, type, featured } = req.query;

    // Only stylists can access this endpoint
    if (role !== "stylist") {
      throw new CustomError.UnauthorizedError("Only stylists can access their products");
    }

    // Create cache key specific to stylist's products
    const cacheKey = `myproducts:${company}:${page}:${limit}:${status || ""}:${category || ""}:${
      type || ""
    }:${featured || ""}`;

    // Try cache first
    const cachedData = await getFromCache(cacheKey);
    if (cachedData) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        ...cachedData,
      });
    }

    const query = {
      stylist: company,
      createdBy: "stylist", // Only products they created
    };

    // Additional filters
    if (status && ["pending", "approved", "rejected"].includes(status)) {
      query.status = status;
    }
    if (category) query.category = category;
    if (type) query.type = type;
    if (featured) query.featured = featured === "true";

    // Pagination
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      Product.find(query)
        .select(
          "name price mainImage rating category featured status stock createdAt rejectionReason"
        )
        .populate("stylist", "name")
        .populate("approvedBy", "name")
        .sort({ createdAt: -1 }) // Newest first
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

    // Cache for 30 minutes (stylist products change more frequently)
    await setInCache(cacheKey, responseData, 1800);

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
    } else if (role === "user") {
      throw new CustomError.UnauthorizedError("Customers cannot update products");
    }

    // Track images to delete if they're being replaced
    const imagesToDelete = [];

    // Check if main image is being updated and delete old one from Sanity
    if (updateData.mainImage && updateData.mainImage !== product.mainImage) {
      if (product.mainImage && product.mainImage.includes("cdn.sanity.io")) {
        imagesToDelete.push(product.mainImage);
      }
    }

    // Check if subImages are being updated and delete removed ones from Sanity
    if (updateData.subImages && Array.isArray(updateData.subImages)) {
      const removedSubImages = product.subImages.filter(
        (oldImage) => !updateData.subImages.includes(oldImage)
      );
      removedSubImages.forEach((imageUrl) => {
        if (imageUrl && imageUrl.includes("cdn.sanity.io")) {
          imagesToDelete.push(imageUrl);
        }
      });
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
      "type",
      "stock",
      "rating",
      "featured",
      "attributes",
      "status",
      "rejectionReason",
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

    // DELETE OLD IMAGES FROM SANITY (after successful update)
    if (imagesToDelete.length > 0) {
      for (const imageUrl of imagesToDelete) {
        try {
          await deleteSanityImageByUrl(imageUrl);
          console.log(`Deleted old image from Sanity: ${imageUrl}`);
        } catch (error) {
          console.warn(`Failed to delete old image ${imageUrl}:`, error.message);
          // Continue even if image deletion fails
        }
      }
    }

    // Clear cache and notify relevant parties
    await Promise.all([clearCache(`product:${id}`), clearCache("products:*")]);

    res.status(StatusCodes.OK).json({
      success: true,
      product,
      message:
        "Product updated successfully" +
        (imagesToDelete.length > 0 ? " and old images cleaned up" : ""),
      deletedImagesCount: imagesToDelete.length,
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
    const { role, company } = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    const product = await Product.findById(id).session(session);
    if (!product) {
      throw new CustomError.NotFoundError(`Product with ID ${id} not found`);
    }

    // Role-based deletion restrictions
    if (role === "stylist") {
      // Stylists can only delete their own pending products
      if (product.stylist.toString() !== company.toString() || product.status !== "pending") {
        throw new CustomError.UnauthorizedError("You can only delete your own pending products");
      }
    } else if (role === "user") {
      throw new CustomError.UnauthorizedError("Customers cannot delete products");
    }

    // Check if product has any reviews (only if not admin)
    if (role !== "admin" && product.reviews.length > 0) {
      throw new CustomError.BadRequestError("Cannot delete product with reviews");
    }

    // DELETE ALL ASSOCIATED IMAGES FROM SANITY
    const imagesToDelete = [];

    // Add main image if it's from Sanity
    if (product.mainImage && product.mainImage.includes("cdn.sanity.io")) {
      imagesToDelete.push(product.mainImage);
    }

    // Add sub images if they're from Sanity
    if (product.subImages && product.subImages.length > 0) {
      product.subImages.forEach((imageUrl) => {
        if (imageUrl && imageUrl.includes("cdn.sanity.io")) {
          imagesToDelete.push(imageUrl);
        }
      });
    }

    // Delete all images from Sanity
    if (imagesToDelete.length > 0) {
      for (const imageUrl of imagesToDelete) {
        try {
          await deleteSanityImageByUrl(imageUrl);
          console.log(`Deleted image from Sanity: ${imageUrl}`);
        } catch (error) {
          console.warn(`Failed to delete image from Sanity: ${imageUrl}`, error.message);
          // Continue with product deletion even if image deletion fails
        }
      }
    }

    // Now delete the product from database
    await Product.findByIdAndDelete(id).session(session);
    await session.commitTransaction();

    // Clear cache
    await Promise.all([clearCache(`product:${id}`), clearCache("products:*")]);

    // Notify if product was deleted by admin
    if (role === "admin" && product.createdBy === "stylist") {
      const notificationPayload = {
        type: "product_deleted",
        message: `Your product "${product.name}" was deleted by admin`,
        data: {
          productId: product._id,
          productName: product.name,
          deletedAt: new Date(),
        },
      };
      emitNotification(req.io, "newNotification", notificationPayload, product.stylist.toString());
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Product and all associated images deleted successfully",
      deletedImagesCount: imagesToDelete.length,
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
const deleteProductImage = async (req, res, next) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      throw new CustomError.BadRequestError("Image URL is required");
    }

    if (!imageUrl.includes("cdn.sanity.io")) {
      throw new CustomError.BadRequestError("Only Sanity images can be deleted");
    }

    const deletedAssetId = await deleteSanityImageByUrl(imageUrl);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Image deleted successfully from Sanity",
      deletedAssetId,
      imageUrl,
    });
  } catch (error) {
    next(error);
  }
};
const addReview = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { comment, rating } = req.body;
    const userId = req.user.id;

    // Initial validations
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    if (!rating || rating < 0 || rating > 5) {
      throw new CustomError.BadRequestError("Rating must be between 0 and 5");
    }

    // Check if user has purchased the product
    const userOrders = await Order.find({
      customer: userId,
      "orderItems.product": productId,
      "orderItems.status": "delivered",
    });

    if (userOrders.length === 0) {
      throw new CustomError.BadRequestError(
        "You can only rate delivered products purchased by you"
      );
    }

    // Start transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
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

      await clearCache(`product:${productId}`);

      res.status(StatusCodes.CREATED).json({
        success: true,
        data: product,
        averageRating: product.averageRating,
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    next(error);
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
// Helper function to delete image from Sanity by URL
const deleteSanityImageByUrl = async (imageUrl) => {
  if (!imageUrl || !imageUrl.includes("cdn.sanity.io")) {
    return null; // Only process Sanity images
  }

  try {
    // Extract asset ID from Sanity image URL
    // URL format: https://cdn.sanity.io/images/projectId/dataset/image-id-500x500.jpg
    const urlParts = imageUrl.split("/");
    const imageIdWithParams = urlParts[urlParts.length - 1];
    const imageId = imageIdWithParams.split("?")[0].split("-")[0];

    if (!imageId) {
      throw new Error("Invalid Sanity image URL format");
    }

    const assetId = `image-${imageId}`;

    // Delete the asset from Sanity
    await writeClient.delete(assetId);

    console.log(`Successfully deleted image from Sanity: ${assetId}`);
    return assetId;
  } catch (error) {
    if (error.statusCode === 404) {
      console.warn(`Image already deleted from Sanity: ${imageUrl}`);
      return null;
    }
    console.error(`Failed to delete image from Sanity: ${imageUrl}`, error);
    throw error;
  }
};
module.exports = {
  addProduct,
  getAllProducts,
  getMyProducts,
  getDetailProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  deleteProductImage,
  addReview,
  updateReview,
  verifyProduct,
};

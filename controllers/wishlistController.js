const Wishlist = require("../models/wishlistModel");
const Cart = require("../models/cartModel");
const Product = require("../models/productModel");
const CustomError = require("../errors");
const { StatusCodes } = require("http-status-codes");
const { getFromCache, setInCache, clearCache } = require("../utils/redisClient");

const mongoose = require("mongoose");

// Add item to wishlist
const addToWishlist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId } = req.body;
    const userId = req.user.id;

    if (!productId) {
      throw new CustomError.BadRequestError("Please provide product ID");
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    // Check if product exists
    const product = await Product.findById(productId).session(session);
    if (!product) {
      throw new CustomError.NotFoundError("Product not found");
    }

    let wishlist = await Wishlist.findOne({ user: userId }).session(session);

    if (!wishlist) {
      // Create new wishlist if it doesn't exist
      wishlist = await Wishlist.create(
        [
          {
            user: userId,
            items: [{ product: productId }],
          },
        ],
        { session },
      );
    } else {
      // Check if product already exists in wishlist
      const itemExists = wishlist.items.some((item) => item.product.toString() === productId);

      if (itemExists) {
        throw new CustomError.BadRequestError("Product already in wishlist");
      }

      // Add new item to wishlist
      wishlist.items.push({ product: productId });
      await wishlist.save({ session });
    }

    await session.commitTransaction();
    await clearCache(`wishlist:${userId}`);

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Product added to wishlist successfully",
      data: wishlist,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// Get user's wishlist
const getMyWishlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const cacheKey = `wishlist:${userId}`;

    // Try cache first
    const cachedWishlist = await getFromCache(cacheKey);
    if (cachedWishlist) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        message: "Wishlist retrieved from cache",
        data: cachedWishlist,
      });
    }

    // Cache miss → fetch from DB
    const wishlist = await Wishlist.findOne({ user: userId }).populate({
      path: "items.product",
      select: "name price mainImage stock stylist",
    });

    let responseData = { items: [] };
    if (wishlist) {
      responseData.items = wishlist.items.map((item) => ({
        id: item._id,
        productId: item.product._id,
        productName: item.product.name,
        image: item.product.mainImage,
        price: item.product.price,
        stylist: item.product.stylist,
        addedAt: item.addedAt,
      }));
    }

    // Cache the result
    await setInCache(cacheKey, responseData);

    res.status(StatusCodes.OK).json({
      success: true,
      fromCache: false,
      message: "Wishlist retrieved from database",
      data: responseData,
    });
  } catch (error) {
    next(error);
  }
};

// Remove item from wishlist
const removeFromWishlist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId } = req.params;
    const userId = req.user.id;

    if (!productId) {
      throw new CustomError.BadRequestError("Please provide product ID");
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    const wishlist = await Wishlist.findOne({ user: userId }).session(session);

    if (!wishlist) {
      throw new CustomError.NotFoundError("Wishlist not found");
    }

    const initialCount = wishlist.items.length;
    wishlist.items = wishlist.items.filter((item) => item.product.toString() !== productId);

    if (wishlist.items.length === initialCount) {
      throw new CustomError.NotFoundError("Product not found in wishlist");
    }

    await wishlist.save({ session });
    await session.commitTransaction();
    await clearCache(`wishlist:${userId}`);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Product removed from wishlist successfully",
      data: wishlist,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// Move item from wishlist to cart
const moveToCart = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId } = req.body;
    const userId = req.user.id;

    if (!productId) {
      throw new CustomError.BadRequestError("Please provide product ID");
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    // 1. Remove from wishlist
    const wishlist = await Wishlist.findOne({ user: userId }).session(session);
    if (!wishlist) {
      throw new CustomError.NotFoundError("Wishlist not found");
    }

    const itemIndex = wishlist.items.findIndex((item) => item.product.toString() === productId);

    if (itemIndex === -1) {
      throw new CustomError.NotFoundError("Product not found in wishlist");
    }

    // Get the product details before removing
    const product = await Product.findById(productId).session(session);
    if (!product) {
      throw new CustomError.NotFoundError("Product not found");
    }

    // Remove from wishlist
    wishlist.items.splice(itemIndex, 1);
    await wishlist.save({ session });

    // 2. Add to cart
    let cart = await Cart.findOne({ user: userId }).session(session);

    if (!cart) {
      cart = await Cart.create(
        [
          {
            user: userId,
            items: [{ product: productId, quantity: 1, price: product.price }],
          },
        ],
        { session },
      );
    } else {
      const existingItem = cart.items.find((item) => item.product.toString() === productId);

      if (existingItem) {
        existingItem.quantity += 1;
      } else {
        cart.items.push({ product: productId, quantity: 1, price: product.price });
      }

      await cart.save({ session });
    }

    await session.commitTransaction();
    await clearCache(`wishlist:${userId}`);
    await clearCache(`cart:${userId}`);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Product moved to cart successfully",
      data: {
        wishlist,
        cart,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

module.exports = {
  addToWishlist,
  getMyWishlist,
  removeFromWishlist,
  moveToCart,
};

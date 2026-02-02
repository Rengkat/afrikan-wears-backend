const Cart = require("../models/cartModel");
const Product = require("../models/productModel");
const CustomError = require("../errors");
const { StatusCodes } = require("http-status-codes");
const { getFromCache, setInCache, clearCache } = require("../utils/redisClient");

const mongoose = require("mongoose");
const addToCart = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId, quantity } = req.body;
    const userId = req.user.id;

    if (!productId || !quantity) {
      throw new CustomError.BadRequestError("Please provide product ID and quantity");
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }
    const product = await Product.findById(productId).session(session);
    if (!product) {
      throw new CustomError.NotFoundError("Product not found");
    }

    // Now we can safely access product.price
    const price = product.price;

    if (product.stock < quantity) {
      throw new CustomError.BadRequestError(`Only ${product.stock} items available`);
    }

    if (quantity <= 0) {
      throw new CustomError.BadRequestError("Quantity must be greater than 0");
    }

    let cart = await Cart.findOne({ user: userId }).session(session);

    if (!cart) {
      cart = await Cart.create(
        [
          {
            user: userId,
            items: [{ product: productId, quantity, price }],
          },
        ],
        { session },
      );
    } else {
      const itemIndex = cart.items.findIndex((item) => item.product.toString() === productId);

      if (itemIndex > -1) {
        cart.items[itemIndex].quantity += quantity;
      } else {
        cart.items.push({ product: productId, quantity, price });
      }

      await cart.save({ session });
    }

    await session.commitTransaction();
    await clearCache(`cart:${userId}`);
    res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Product added to cart successfully",
      data: cart,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const getAllCartProducts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const cacheKey = `cart:${userId}`;

    // Try cache first
    const cachedCart = await getFromCache(cacheKey);
    if (cachedCart) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        message: "Cart retrieved from cache",
        data: cachedCart,
      });
    }

    // Cache miss → fetch from DB
    const cart = await Cart.findOne({ user: userId }).populate({
      path: "items.product",
      select: "name price mainImage stock",
    });

    let responseData;
    if (!cart) {
      responseData = { items: [], total: 0 };
    } else {
      const total = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      responseData = {
        items: cart.items,
        total: parseFloat(total.toFixed(2)),
      };
    }

    // Cache the result
    await setInCache(cacheKey, responseData);

    res.status(StatusCodes.OK).json({
      success: true,
      fromCache: false,
      message: "Cart retrieved from database",
      data: responseData,
    });
  } catch (error) {
    next(error);
  }
};
const removeFromCart = async (req, res, next) => {
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

    const cart = await Cart.findOne({ user: userId }).session(session);

    if (!cart) {
      throw new CustomError.NotFoundError("Cart not found");
    }

    const initialCount = cart.items.length;
    cart.items = cart.items.filter((item) => item.product.toString() !== productId);

    if (cart.items.length === initialCount) {
      throw new CustomError.NotFoundError("Product not found in cart");
    }

    await cart.save({ session });
    await session.commitTransaction();
    // Clear the user's cart cache
    await clearCache(`cart:${userId}`);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Product removed from cart successfully",
      data: cart,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
const updateCart = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId } = req.params;
    const { quantity } = req.body;
    const userId = req.user.id;

    if (!productId || !quantity) {
      throw new CustomError.BadRequestError("Please provide product ID and quantity");
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }

    if (quantity <= 0) {
      throw new CustomError.BadRequestError("Quantity must be greater than 0");
    }

    const cart = await Cart.findOne({ user: userId }).session(session);
    const product = await Product.findById(productId).session(session);

    if (product.stock < quantity) {
      throw new CustomError.BadRequestError(`Only ${product.stock} items available`);
    }

    if (!cart) {
      throw new CustomError.NotFoundError("Cart not found");
    }

    const itemIndex = cart.items.findIndex((item) => item.product.toString() === productId);

    if (itemIndex === -1) {
      throw new CustomError.NotFoundError("Product not found in cart");
    }

    cart.items[itemIndex].quantity = quantity;
    await cart.save({ session });
    await session.commitTransaction();
    await clearCache(`cart:${userId}`);
    res.status(StatusCodes.OK).json({
      success: true,
      message: "Cart updated successfully",
      data: cart,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const clearCart = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.id;
    const cart = await Cart.findOneAndUpdate(
      { user: userId },
      { $set: { items: [] } },
      { new: true, session },
    );

    if (!cart) {
      throw new CustomError.NotFoundError("Cart not found");
    }

    await session.commitTransaction();
    // Clear the user's cart cache
    await clearCache(`cart:${userId}`);
    res.status(StatusCodes.OK).json({
      success: true,
      message: "Cart cleared successfully",
      data: cart,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
// Move item from cart to wishlist
const moveToWishlist = async (req, res, next) => {
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

    // 1. Remove from cart
    const cart = await Cart.findOne({ user: userId }).session(session);
    if (!cart) {
      throw new CustomError.NotFoundError("Cart not found");
    }

    const itemIndex = cart.items.findIndex((item) => item.product.toString() === productId);

    if (itemIndex === -1) {
      throw new CustomError.NotFoundError("Product not found in cart");
    }

    // Verify product exists
    const product = await Product.findById(productId).session(session);
    if (!product) {
      throw new CustomError.NotFoundError("Product not found");
    }

    // Remove from cart
    cart.items.splice(itemIndex, 1);
    await cart.save({ session });

    // 2. Add to wishlist
    let wishlist = await Wishlist.findOne({ user: userId }).session(session);

    if (!wishlist) {
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
      const existsInWishlist = wishlist.items.some((item) => item.product.toString() === productId);

      if (!existsInWishlist) {
        wishlist.items.push({ product: productId });
        await wishlist.save({ session });
      }
    }

    await session.commitTransaction();
    await clearCache(`cart:${userId}`);
    await clearCache(`wishlist:${userId}`);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Product moved to wishlist successfully",
      data: {
        cart,
        wishlist,
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
  addToCart,
  removeFromCart,
  updateCart,
  getAllCartProducts,
  clearCart,
  moveToWishlist,
};

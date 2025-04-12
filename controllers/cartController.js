const Cart = require("../models/cartModel");
const Product = require("../models/productModel");
const CustomError = require("../errors");
const { StatusCodes } = require("http-status-codes");
const mongoose = require("mongoose");
const addToCart = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId, quantity } = req.body; // Removed price from destructuring
    const userId = req.user.id;

    if (!productId || !quantity) {
      // Removed price check here
      throw new CustomError.BadRequestError("Please provide product ID and quantity");
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new CustomError.BadRequestError("Invalid product ID");
    }
    onlyUsers(req.user);
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
        { session }
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
    const cart = await Cart.findOne({ user: userId }).populate({
      path: "items.product",
      select: "name price mainImage stock",
    });

    if (!cart) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Your cart is empty",
        data: { items: [], total: 0 },
      });
    }

    // Calculate total price
    const total = cart.items.reduce((sum, item) => {
      return sum + item.price * item.quantity;
    }, 0);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Cart products retrieved successfully",
      data: {
        items: cart.items,
        total: parseFloat(total.toFixed(2)),
      },
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
    const { productId, quantity } = req.body;
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

    const cart = await Cart.findById({ user: userId }).session(session);
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
      { new: true, session }
    );

    if (!cart) {
      throw new CustomError.NotFoundError("Cart not found");
    }

    await session.commitTransaction();
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

module.exports = {
  addToCart,
  removeFromCart,
  updateCart,
  getAllCartProducts,
  clearCart,
};

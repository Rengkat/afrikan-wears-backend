const Cart = require("../models/cartModel");
const CustomError = require("../errors");
const { StatusCodes } = require("http-status-codes");
const addToCart = async (req, res, next) => {
  const { productId, quantity, price } = req.body;
  try {
    const userId = req.user.id;
    if (!productId || !quantity || !price) {
      throw new CustomError.BadRequestError("Please provide product ID, quantity, and price");
    }

    let cart = await Cart.findOne({ user: userId });

    if (!cart) {
      cart = new Cart({
        user: userId,
        items: [{ product: productId, quantity, price }],
      });
    } else {
      const itemIndex = cart.items.findIndex((item) => item.product.toString() === productId);

      if (itemIndex > -1) {
        cart.items[itemIndex].quantity += quantity;
      } else {
        cart.items.push({ product: productId, quantity, price });
      }
    }

    await cart.save();

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Product added to cart successfully",
      data: cart,
    });
  } catch (error) {
    next(error);
  }
};
const getAllCartProducts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const cart = await Cart.findOne({ user: userId }).populate({
      path: "items.product",
      select: "name price image",
    });

    if (!cart) {
      throw new CustomError.NotFoundError("Cart not found");
    }

    if (cart.items.length === 0) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Your cart is empty",
        data: [],
      });
    }

    // Format the response to include product details
    const cartProducts = cart.items.map((item) => ({
      product: item.product,
      quantity: item.quantity,
      price: item.price,
    }));

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Cart products retrieved successfully",
      data: cartProducts,
    });
  } catch (error) {
    next(error);
  }
};
const removeFromCart = async (req, res, next) => {
  try {
    const { productId } = req.body;
    const userId = req.user.id;

    if (!productId) {
      throw new CustomError.BadRequestError("Please provide product ID");
    }

    const cart = await Cart.findOne({ user: userId });

    if (!cart) {
      throw new CustomError.NotFoundError("Cart not found");
    }

    cart.items = cart.items.filter((item) => item.product.toString() !== productId);

    await cart.save();

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Product removed from cart successfully",
      data: cart,
    });
  } catch (error) {
    next(error);
  }
};
const updateCart = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    const userId = req.user.id;

    if (!productId || !quantity) {
      throw new CustomError.BadRequestError("Please provide product ID and quantity");
    }

    const cart = await Cart.findOne({ user: userId });

    if (!cart) {
      throw new CustomError.NotFoundError("Cart not found");
    }

    const itemIndex = cart.items.findIndex((item) => item.product.toString() === productId);

    if (itemIndex === -1) {
      throw new CustomError.NotFoundError("Product not found in cart");
    }

    cart.items[itemIndex].quantity = quantity;

    await cart.save();

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Cart updated successfully",
      data: cart,
    });
  } catch (error) {
    next(error);
  }
};
module.exports = { addToCart, removeFromCart, updateCart, getAllCartProducts };

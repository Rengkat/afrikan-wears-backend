const Cart = require("../models/cartModel");
const CustomError = require("../errors");
const { StatusCodes } = require("http-status-codes");
const addToCart = async (req, res, next) => {
  const { productId, quantity, price } = req.body;
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
};
const removeFromCart = async (req, res, next) => {};
const updateCart = async (req, res, next) => {};
module.exports = { addToCart, removeFromCart, updateCart };

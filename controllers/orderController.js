const Order = require("../models/orderModel");
const Product = require("../models/productModel");
const Cart = require("../models/cartModel");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const mongoose = require("mongoose");
const { emitMessageEvent } = require("../utils");
const redisClient = require("../utils/redisClient");

const createOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { shippingAddress, paymentInfo } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!shippingAddress || !paymentInfo) {
      throw new CustomError.BadRequestError("Please provide shipping address and payment info");
    }

    // Get user's cart
    const cart = await Cart.findOne({ user: userId }).session(session);
    if (!cart || cart.items.length === 0) {
      throw new CustomError.BadRequestError("No items in cart");
    }

    // Prepare order items
    const orderItems = await Promise.all(
      cart.items.map(async (item) => {
        const product = await Product.findById(item.product).session(session);
        if (!product) {
          throw new CustomError.NotFoundError(`Product not found: ${item.product}`);
        }

        // Check stock availability
        if (product.stock < item.quantity) {
          throw new CustomError.BadRequestError(
            `Insufficient stock for ${product.name}. Only ${product.stock} available`
          );
        }

        // Reduce product stock
        product.stock -= item.quantity;
        await product.save({ session });

        return {
          product: item.product,
          quantity: item.quantity,
          priceAtPurchase: product.price,
          stylist: product.stylist,
        };
      })
    );

    // Calculate prices
    const itemsPrice = orderItems.reduce(
      (total, item) => total + item.priceAtPurchase * item.quantity,
      0
    );
    const taxPrice = itemsPrice * 0.1; // Example: 10% tax
    const shippingPrice = 15; // Example flat rate shipping
    const totalPrice = itemsPrice + taxPrice + shippingPrice;

    // Create order
    const order = await Order.create(
      [
        {
          customer: userId,
          orderItems,
          shippingAddress,
          paymentInfo: {
            ...paymentInfo,
            amountPaid: totalPrice,
            paymentDate: paymentInfo.paymentStatus === "completed" ? new Date() : null,
          },
          itemsPrice,
          taxPrice,
          shippingPrice,
          totalPrice,
        },
      ],
      { session }
    );

    // Clear cart
    await Cart.findByIdAndDelete(cart._id, { session });

    // Clear relevant caches
    await redisClient.del(`user:${userId}:orders`);
    orderItems.forEach(async (item) => {
      await redisClient.del(`stylist:${item.stylist}:orders`);
    });

    await session.commitTransaction();

    // Notify stylists about new orders
    orderItems.forEach((item) => {
      emitMessageEvent(req.io, "newOrder", {
        orderId: order[0]._id,
        stylistId: item.stylist,
        productId: item.product,
        quantity: item.quantity,
      });
    });

    res.status(StatusCodes.CREATED).json({
      success: true,
      order: order[0],
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const getSingleOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const order = await Order.findOne({
      _id: id,
      $or: [{ customer: userId }, { "orderItems.stylist": userId }],
    })
      .populate("customer", "name email")
      .populate("orderItems.product", "name mainImage price")
      .populate("orderItems.stylist", "name");

    if (!order) {
      throw new CustomError.NotFoundError(`Order not found with id: ${id}`);
    }

    res.status(StatusCodes.OK).json({
      success: true,
      order,
    });
  } catch (error) {
    next(error);
  }
};

const getMyOrders = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    const cacheKey = `user:${userId}:orders:page:${page}:limit:${limit}`;
    const cachedOrders = await redisClient.get(cacheKey);

    if (cachedOrders) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        orders: cachedOrders,
      });
    }

    const orders = await Order.find({ customer: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("orderItems.product", "name mainImage");

    await redisClient.set(cacheKey, orders, 600); // Cache for 10 minutes

    res.status(StatusCodes.OK).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    next(error);
  }
};

const getStylistOrders = async (req, res, next) => {
  try {
    const stylistId = req.user.id;
    const { page = 1, limit = 10, status } = req.query;

    const cacheKey = `stylist:${stylistId}:orders:status:${
      status || "all"
    }:page:${page}:limit:${limit}`;
    const cachedOrders = await redisClient.get(cacheKey);

    if (cachedOrders) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        orders: cachedOrders,
      });
    }

    const query = { "orderItems.stylist": stylistId };
    if (status) query.orderStatus = status;

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("customer", "name email")
      .populate("orderItems.product", "name mainImage");

    await redisClient.set(cacheKey, orders, 600); // Cache for 10 minutes

    res.status(StatusCodes.OK).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    next(error);
  }
};

const updateOrderStatus = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    if (!status) {
      throw new CustomError.BadRequestError("Please provide status");
    }

    const order = await Order.findOne({
      _id: id,
      "orderItems.stylist": userId,
    }).session(session);

    if (!order) {
      throw new CustomError.NotFoundError(`Order not found with id: ${id}`);
    }

    order.orderStatus = status;
    if (status === "delivered") {
      order.deliveredAt = new Date();
    }

    await order.save({ session });
    await session.commitTransaction();

    // Clear relevant caches
    await redisClient.del(`user:${order.customer}:orders*`);
    await redisClient.del(`stylist:${userId}:orders*`);

    // Notify customer about order status change
    emitMessageEvent(req.io, "orderStatusChanged", {
      orderId: order._id,
      customerId: order.customer,
      newStatus: status,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      order,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const updateOrderItemStatus = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id, itemId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    if (!status) {
      throw new CustomError.BadRequestError("Please provide status");
    }

    const order = await Order.findOne({
      _id: id,
      "orderItems.stylist": userId,
    }).session(session);

    if (!order) {
      throw new CustomError.NotFoundError(`Order not found with id: ${id}`);
    }

    const itemIndex = order.orderItems.findIndex(
      (item) => item._id.toString() === itemId && item.stylist.toString() === userId.toString()
    );

    if (itemIndex === -1) {
      throw new CustomError.NotFoundError("Order item not found or unauthorized");
    }

    order.orderItems[itemIndex].status = status;
    await order.save({ session });
    await session.commitTransaction();

    // Clear relevant caches
    await redisClient.del(`user:${order.customer}:orders*`);
    await redisClient.del(`stylist:${userId}:orders*`);

    res.status(StatusCodes.OK).json({
      success: true,
      order,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

module.exports = {
  createOrder,
  getSingleOrder,
  getMyOrders,
  getStylistOrders,
  updateOrderStatus,
  updateOrderItemStatus,
};

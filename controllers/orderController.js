const Order = require("../models/orderModel");
const Product = require("../models/productModel");
const Cart = require("../models/cartModel");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const mongoose = require("mongoose");
const { emitMessageEvent } = require("../utils");
const { getFromCache, setInCache, clearCache } = require("../utils/redisClient");
const paystack = require("paystack-api")(process.env.PAYSTACK_SECRET_KEY);
const createOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { shippingAddress, paymentMethod } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!shippingAddress || !paymentMethod) {
      throw new CustomError.BadRequestError("Please provide shipping address and payment method");
    }

    // Get user's cart
    const cart = await Cart.findOne({ user: userId }).session(session);
    if (!cart || cart.items.length === 0) {
      throw new CustomError.BadRequestError("No items in cart");
    }

    // Prepare order items (without modifying stock yet)
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
    const taxPrice = itemsPrice * 0.1;
    const shippingPrice = 15;
    const totalPrice = itemsPrice + taxPrice + shippingPrice;

    // Create order with pending payment status
    const order = await Order.create(
      [
        {
          customer: userId,
          orderItems,
          shippingAddress,
          paymentInfo: {
            paymentMethod,
            paymentStatus: "pending",
            amountPaid: totalPrice,
          },
          itemsPrice,
          taxPrice,
          shippingPrice,
          totalPrice,
          orderStatus: "pending",
        },
      ],
      { session }
    );

    // Initialize Paystack payment
    const paystackResponse = await paystack.transaction.initialize({
      email: req.user.email,
      amount: Math.round(totalPrice * 100), // Paystack expects amount in kobo
      reference: `order_${order[0]._id}_${Date.now()}`,
      callback_url: `${process.env.ORIGIN}/api/v1/orders/verify-payment?orderId=${order[0]._id}`,
      metadata: {
        order_id: order[0]._id.toString(),
        customer_id: userId.toString(),
      },
    });

    if (!paystackResponse.status) {
      throw new CustomError.BadRequestError("Payment initialization failed");
    }

    // Update order with payment reference
    order[0].paymentInfo.transactionId = paystackResponse.data.reference;
    await order[0].save({ session });

    await session.commitTransaction();

    res.status(StatusCodes.OK).json({
      success: true,
      authorizationUrl: paystackResponse.data.authorization_url,
      order: order[0],
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const verifyPayment = async (req, res, next) => {
  const { orderId } = req.query;
  const { reference } = req.body;

  if (!orderId || !reference) {
    throw new CustomError.BadRequestError("Order ID and payment reference are required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Verify payment with Paystack
    const paymentResponse = await paystack.transaction.verify(reference);

    if (!paymentResponse.status) {
      throw new CustomError.BadRequestError("Payment verification failed");
    }

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      throw new CustomError.NotFoundError(`Order not found: ${orderId}`);
    }

    // Check if payment was successful
    if (paymentResponse.data.status !== "success") {
      order.paymentInfo.paymentStatus = "failed";
      await order.save({ session });
      await session.commitTransaction();
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Payment failed",
        order,
      });
    }

    // Check if amount paid matches order total
    const amountPaid = paymentResponse.data.amount / 100;
    if (amountPaid < order.totalPrice) {
      throw new CustomError.BadRequestError("Amount paid is less than order total");
    }

    // Update order status and reduce product stock
    order.paymentInfo.paymentStatus = "completed";
    order.paymentInfo.paymentDate = new Date();
    order.orderStatus = "processing";

    // Reduce product stock
    await Promise.all(
      order.orderItems.map(async (item) => {
        const product = await Product.findById(item.product).session(session);
        product.stock -= item.quantity;
        await product.save({ session });
      })
    );

    await order.save({ session });

    // Clear cart and relevant caches
    await Cart.findOneAndDelete({ user: order.customer }).session(session);
    await Promise.all([
      clearCache(`user:${order.customer}:orders*`),
      ...order.orderItems.map((item) => clearCache(`stylist:${item.stylist}:orders*`)),
    ]);

    await session.commitTransaction();

    // Notify stylists about new orders
    order.orderItems.forEach((item) => {
      emitMessageEvent(req.io, "newOrder", {
        orderId: order._id,
        stylistId: item.stylist,
        productId: item.product,
        quantity: item.quantity,
      });
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Payment verified successfully",
      order,
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
    const cacheKey = `order:${id}:user:${userId}`;

    const cachedOrder = await getFromCache(cacheKey);
    if (cachedOrder) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        order: cachedOrder,
      });
    }

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

    await setInCache(cacheKey, order);

    res.status(StatusCodes.OK).json({
      success: true,
      fromCache: false,
      order,
    });
  } catch (error) {
    next(error);
  }
};
const getAllOrder = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const cacheKey = `orders:page:${page}:limit:${limit}`;
    const cachedOrders = await getFromCache(cacheKey);
    if (cachedOrders) {
      res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        orders: cachedOrders,
      });
    }
    const orders = await Order.find({})
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("orderItems.product", "name mainImage");
    await setInCache(cacheKey, orders);

    res.status(StatusCodes.OK).json({
      success: true,
      count: orders.length,
      orders,
      fromCache: false,
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
    const cachedOrders = await getFromCache(cacheKey);

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

    await setInCache(cacheKey, orders);

    res.status(StatusCodes.OK).json({
      success: true,
      count: orders.length,
      orders,
      fromCache: false,
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
    const cachedOrders = await getFromCache(cacheKey);

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

    await setInCache(cacheKey, orders);
    res.status(StatusCodes.OK).json({
      success: true,
      count: orders.length,
      orders,
      fromCache: false,
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
    await clearCache(`user:${order.customer}:orders*`);
    await clearCache(`stylist:${userId}:orders*`);

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
    await clearCache(`user:${order.customer}:orders*`);
    await clearCache(`stylist:${userId}:orders*`);

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
  verifyPayment,
  getSingleOrder,
  getMyOrders,
  getAllOrders,
  getStylistOrders,
  updateOrderStatus,
  updateOrderItemStatus,
};

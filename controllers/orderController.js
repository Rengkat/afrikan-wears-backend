const Order = require("../models/orderModel");
const Stylist = require("../models/stylistModel");
const Product = require("../models/productModel");
const User = require("../models/userModel");
const Cart = require("../models/cartModel");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const mongoose = require("mongoose");
const { getFromCache, setInCache, clearCache } = require("../utils/redisClient");
const { emitNotification } = require("../utils/socket");
const sendPlacedOrderEmail = require("../utils/Email/sendOrderEmail");
const paystack = require("paystack-api")(process.env.PAYSTACK_SECRET_KEY);
const createOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { shippingAddress, paymentMethod, orderType, measurements, materialSample } = req.body;
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

    // Prepare order items
    const orderItems = await Promise.all(
      cart.items.map(async (item) => {
        const product = await Product.findById(item.product).session(session);
        if (!product) {
          throw new CustomError.NotFoundError(`Product not found: ${item.product}`);
        }

        // For standard orders, check stock availability
        if (orderType === "standard" && product.stock < item.quantity) {
          throw new CustomError.BadRequestError(
            `Insufficient stock for ${product.name}. Only ${product.stock} available`
          );
        }

        const orderItem = {
          product: item.product,
          quantity: item.quantity,
          priceAtPurchase: product.price,
          stylist: product.stylist,
          orderType,
        };

        // Add custom order details if it's a custom order
        if (orderType === "custom") {
          if (!measurements) {
            throw new CustomError.BadRequestError("Measurements are required for custom orders");
          }

          orderItem.measurements = measurements;
          orderItem.materialSample = materialSample;
          orderItem.paymentPlan = "partial";
          orderItem.amountPaid = product.price * item.quantity * 0.6;
          orderItem.balanceDue = product.price * item.quantity * 0.4;
        }

        return orderItem;
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

    // For custom orders, calculate initial payment (60%)
    const initialPayment = orderType === "custom" ? totalPrice * 0.6 : totalPrice;
    const balanceDue = orderType === "custom" ? totalPrice * 0.4 : 0;

    // Handle different payment methods
    let paymentStatus = "pending";
    let amountPaid = 0;
    let transactionId = null;
    let authorizationUrl = null;

    // Wallet payment logic
    if (paymentMethod === "wallet") {
      const user = await User.findById(userId).session(session);
      if (!user) {
        throw new CustomError.NotFoundError("User not found");
      }

      // Check if user has sufficient balance
      if (user.walletBalance < initialPayment) {
        throw new CustomError.BadRequestError("Insufficient wallet balance");
      }

      // Deduct from wallet
      user.walletBalance -= initialPayment;
      await user.save({ session });

      paymentStatus = orderType === "custom" ? "partially_paid" : "completed";
      amountPaid = initialPayment;
      transactionId = `wallet-${Date.now()}`;
    }
    // Cash on delivery logic
    else if (paymentMethod === "cash_on_delivery") {
      // For custom orders with cash on delivery, we only allow it for final payment
      if (orderType === "custom") {
        throw new CustomError.BadRequestError(
          "Cash on delivery is only available for final payment of custom orders"
        );
      }

      paymentStatus = "pending";
      amountPaid = 0;
    }
    // Online payment (Paystack)
    else {
      // Initialize Paystack payment
      const paystackResponse = await paystack.transaction.initialize({
        email: req.user.email,
        amount: Math.round(initialPayment * 100),
        callback_url: `${process.env.ORIGIN}/api/v1/orders/verify-payment?orderId=${order[0]._id}`,
        metadata: {
          order_id: order[0]._id.toString(),
          customer_id: userId.toString(),
          order_type: orderType,
        },
      });

      if (!paystackResponse.status) {
        throw new CustomError.BadRequestError("Payment initialization failed");
      }

      transactionId = paystackResponse.data.reference;
      authorizationUrl = paystackResponse.data.authorization_url;
    }

    // Create order with appropriate payment status
    const order = await Order.create(
      [
        {
          customer: userId,
          orderItems,
          shippingAddress,
          paymentInfo: {
            paymentMethod,
            paymentStatus,
            amountPaid,
            balanceDue,
            transactionId,
          },
          itemsPrice,
          taxPrice,
          shippingPrice,
          totalPrice,
          orderStatus: paymentStatus === "completed" ? "processing" : "pending",
        },
      ],
      { session }
    );

    // For standard orders and completed payments, reduce stock immediately
    if (orderType === "standard" && paymentStatus === "completed") {
      await Promise.all(
        order[0].orderItems.map(async (item) => {
          const product = await Product.findById(item.product).session(session);
          product.stock -= item.quantity;
          await product.save({ session });
        })
      );
    }

    await session.commitTransaction();

    res.status(StatusCodes.OK).json({
      success: true,
      authorizationUrl,
      order: order[0],
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

// Add a new controller for final payment
const completeCustomOrderPayment = async (req, res, next) => {
  const { orderId } = req.params;
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

    // Check if order is a custom order
    const isCustomOrder = order.orderItems.some((item) => item.orderType === "custom");
    if (!isCustomOrder) {
      throw new CustomError.BadRequestError("This is not a custom order");
    }

    // Check if payment was successful
    if (paymentResponse.data.status !== "success") {
      throw new CustomError.BadRequestError("Payment failed");
    }

    // Check if amount paid matches the balance due
    const amountPaid = paymentResponse.data.amount / 100;
    if (amountPaid < order.paymentInfo.balanceDue) {
      throw new CustomError.BadRequestError("Amount paid is less than the balance due");
    }

    // Update payment info
    order.paymentInfo.amountPaid += amountPaid;
    order.paymentInfo.balanceDue = 0;
    order.paymentInfo.paymentStatus = "completed";
    order.paymentInfo.paymentDate = new Date();

    await order.save({ session });
    await session.commitTransaction();

    // Clear relevant caches
    await clearCache(`user:${order.customer}:orders*`);
    await Promise.all(
      order.orderItems.map((item) => clearCache(`stylist:${item.stylist}:orders*`))
    );

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Final payment completed successfully",
      order,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
const verifyPayment = async (req, res, next) => {
  const { orderId } = req.params;
  const { reference } = req.query;

  if (!orderId || !reference) {
    throw new CustomError.BadRequestError("Order ID and payment reference are required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Verify payment with Paystack
    const paymentResponse = await paystack.transaction.verify({ reference });

    if (!paymentResponse?.data) {
      throw new CustomError.BadRequestError("Invalid payment response");
    }

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      throw new CustomError.NotFoundError(`Order not found: ${orderId}`);
    }

    if (!order.orderItems || order.orderItems.length === 0) {
      throw new CustomError.BadRequestError("Order has no items");
    }

    // Check payment status
    if (paymentResponse.data.status !== "success") {
      order.paymentInfo.paymentStatus = "failed";
      await order.save({ session });
      await session.commitTransaction();
      session.endSession();
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

    // Update order status
    order.paymentInfo.paymentStatus = "completed";
    order.paymentInfo.paymentDate = new Date();
    order.orderStatus = "processing";

    // Reduce product stock
    await Promise.all(
      order.orderItems.map(async (item) => {
        const product = await Product.findById(item.product).session(session);
        if (!product) {
          throw new CustomError.NotFoundError(`Product not found: ${item.product}`);
        }
        product.stock -= item.quantity;
        await product.save({ session });
      })
    );

    await order.save({ session });

    // Clear cart and cache
    await Cart.findOneAndDelete({ user: order.customer }).session(session);
    await Promise.all([
      clearCache(`user:${order.customer}:orders*`),
      ...order.orderItems
        .map((item) => (item.stylist ? clearCache(`stylist:${item.stylist}:orders*`) : null))
        .filter(Boolean),
    ]);

    await session.commitTransaction();

    // Notify stylists and admin
    // After successful payment processing:
    const customer = await User.findById(order.customer).select("name email").lean();
    const customerName = customer?.name || "Customer";

    // Admin notification
    const adminNotification = {
      type: "new_order",
      message: `New order #${order.orderNumber} (N${order.totalPrice})`,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        customerName,
        totalAmount: order.totalPrice,
        itemsCount: order.orderItems.length,
        timestamp: new Date(),
      },
    };
    emitNotification(req.io, "newNotification", adminNotification, "admin_room");

    // Stylist notifications
    const stylistNotifications = new Map();

    for (const item of order.orderItems) {
      if (!item.stylist) continue;

      const stylistId = item.stylist.toString();
      const product = await Product.findById(item.product).select("name").lean();

      if (!stylistNotifications.has(stylistId)) {
        const stylist = await Stylist.findById(stylistId).select("name").lean();
        stylistNotifications.set(stylistId, {
          stylistName: stylist?.name || "Stylist",
          items: [],
        });
      }

      stylistNotifications.get(stylistId).items.push({
        productName: product?.name || "Product",
        quantity: item.quantity,
        price: item.priceAtPurchase,
      });
    }

    // Send individual notifications to each stylist
    for (const [stylistId, data] of stylistNotifications) {
      const stylistNotification = {
        type: "new_order",
        message: `New order for your products (Order #${order.orderNumber})`,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          customerName,
          items: data.items,
          timestamp: new Date(),
        },
      };
      emitNotification(req.io, "newNotification", stylistNotification, stylistId);
    }

    // Also send email message to both customer and the stylist
    // Send email to customer
    await sendPlacedOrderEmail({
      name: customer?.name || "Customer",
      email: customer?.email,
      origin: process.env.ORIGIN,
      payload: order,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Payment verified successfully",
      order,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    next(error);
  } finally {
    if (session) {
      session.endSession();
    }
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
const getAllOrders = async (req, res, next) => {
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
    const customer = await User.findById(order.customer).select("name email").lean();

    // Notify customer about order status change
    const statusNotification = {
      type: "order_status_update",
      message: `Your order status is now: ${status}`,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        newStatus: status,
        updatedAt: new Date(),
      },
    };
    await sendPlacedOrderEmail({
      name: customer?.name || "Customer",
      email: customer?.email,
      origin: process.env.ORIGIN,
      payload: order,
    });

    emitNotification(req.io, "newNotification", statusNotification, order.customer.toString());

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
  completeCustomOrderPayment,
  updateOrderItemStatus,
};

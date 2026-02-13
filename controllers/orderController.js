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
const { generatePaymentReference } = require("../utils/payment");
const PaymentService = require("../utils/paystack");
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

    // Prepare order items and validate products
    const orderItems = [];
    for (const item of cart.items) {
      const product = await Product.findById(item.product).session(session);
      if (!product) {
        throw new CustomError.NotFoundError(`Product not found: ${item.product}`);
      }

      // For standard orders, check stock availability
      if (orderType === "standard" && product.stock < item.quantity) {
        throw new CustomError.BadRequestError(
          `Insufficient stock for ${product.name}. Only ${product.stock} available`,
        );
      }

      const orderItem = {
        product: item.product,
        quantity: item.quantity,
        priceAtPurchase: product.price,
        stylist: product.stylist,
        orderType,
        status: "pending",
      };

      // Add custom order details if it's a custom order
      if (orderType === "custom") {
        if (!measurements) {
          throw new CustomError.BadRequestError("Measurements are required for custom orders");
        }

        orderItem.measurements = measurements;
        orderItem.materialSample = materialSample;
        orderItem.paymentPlan = "partial";
      }

      orderItems.push(orderItem);
    }

    // Calculate prices
    const itemsPrice = orderItems.reduce(
      (total, item) => total + item.priceAtPurchase * item.quantity,
      0,
    );
    const taxPrice = itemsPrice * 0.1;
    const shippingPrice = 15;
    const totalPrice = itemsPrice + taxPrice + shippingPrice;

    const initialPayment = orderType === "custom" ? totalPrice * 0.6 : totalPrice;
    const balanceDue = orderType === "custom" ? totalPrice - initialPayment : 0;

    // Handle different payment methods
    let paymentStatus = "pending";
    let amountPaid = 0;
    let transactionId = null;
    let authorizationUrl = null;
    let paymentInit = null;

    if (paymentMethod === "wallet") {
      const user = await User.findById(userId).session(session);
      if (!user) {
        throw new CustomError.NotFoundError("User not found");
      }

      if (user.walletBalance < initialPayment) {
        throw new CustomError.BadRequestError("Insufficient wallet balance");
      }

      user.walletBalance -= initialPayment;
      await user.save({ session });

      paymentStatus = orderType === "custom" ? "partially_paid" : "completed";
      amountPaid = initialPayment;
      transactionId = generatePaymentReference("ORDER", userId);
    }
    // Cash on delivery logic
    else if (paymentMethod === "cash_on_delivery") {
      if (orderType === "custom") {
        throw new CustomError.BadRequestError(
          "Cash on delivery is only available for final payment of custom orders",
        );
      }
      paymentStatus = "pending";
      amountPaid = 0;
      transactionId = generatePaymentReference("COD", userId);
    }
    // Online payment (Paystack)
    else if (paymentMethod === "credit_card" || paymentMethod === "bank_transfer") {
      // Generate reference in controller
      transactionId = generatePaymentReference("ORDER", userId);

      // We'll ONLY pass the reference in the callback URL
      // The order will be found using the reference in the verifyPayment function
      paymentInit = await PaymentService.initializePayment({
        user: req.user,
        amount: initialPayment,
        purpose: "order_payment",
        description: `Payment for ${orderType} order`,
        reference: transactionId,
        callbackUrl: `${process.env.ORIGIN}/account/user/orders/verify-payment?reference=${transactionId}`,
        metadata: {
          order_type: orderType,
        },
      });

      authorizationUrl = paymentInit.authorizationUrl;
    } else {
      throw new CustomError.BadRequestError("Invalid payment method");
    }

    // Create order
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
      { session },
    );

    // Create transaction record for online payments
    if ((paymentMethod === "credit_card" || paymentMethod === "bank_transfer") && paymentInit) {
      await PaymentService.createPendingTransaction({
        user: req.user,
        amount: initialPayment,
        type: "debit",
        purpose: "order_payment",
        description: `Payment for order #${order[0]._id}`,
        reference: transactionId,
        authorizationUrl: paymentInit.authorizationUrl,
        accessCode: paymentInit.accessCode,
        relatedModel: "Order",
        relatedModelId: order[0]._id,
        session,
      });
    }

    // For standard orders and completed payments, reduce stock immediately
    if (orderType === "standard" && paymentStatus === "completed") {
      for (const item of order[0].orderItems) {
        const product = await Product.findById(item.product).session(session);
        if (product) {
          product.stock -= item.quantity;
          await product.save({ session });
        }
      }
    }

    // Clear cart after successful order creation
    await Cart.findOneAndDelete({ user: userId }).session(session);
    // then delete cart from cache
    clearCache(`cart:${userId}`);
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

//  final payment
const completeCustomOrderPayment = async (req, res, next) => {
  const { orderId } = req.params;
  const { reference } = req.body;

  if (!orderId || !reference) {
    throw new CustomError.BadRequestError("Order ID and payment reference are required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Use PaymentService for verification
    const verificationResult = await PaymentService.verifyPayment(reference);
    const paymentData = verificationResult.data;

    if (!verificationResult.success) {
      throw new CustomError.BadRequestError("Payment verification failed");
    }

    if (paymentData.status !== "success") {
      throw new CustomError.BadRequestError("Payment failed");
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
    if (paymentData.status !== "success") {
      throw new CustomError.BadRequestError("Payment failed");
    }

    // Check if amount paid matches the balance due
    const amountPaid = paymentData.amount / 100;
    if (amountPaid < order.paymentInfo.balanceDue) {
      throw new CustomError.BadRequestError("Amount paid is less than the balance due");
    }

    // Update payment info
    order.paymentInfo.amountPaid += amountPaid;
    order.paymentInfo.balanceDue = 0;
    order.paymentInfo.paymentStatus = "completed";
    order.paymentInfo.paymentDate = new Date();
    order.orderStatus = "processing";

    await order.save({ session });
    await session.commitTransaction();

    // Clear relevant caches
    await clearCache(`user:${order.customer}:orders*`);
    await Promise.all(
      order.orderItems
        .map((item) => (item.stylist ? clearCache(`stylist:${item.stylist}:orders*`) : null))
        .filter(Boolean),
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
  const { reference } = req.query;

  if (!reference) {
    throw new CustomError.BadRequestError("Payment reference is required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Use PaymentService for verification
    const verificationResult = await PaymentService.verifyPayment(reference);
    const paymentData = verificationResult.data;

    if (!verificationResult.success) {
      throw new CustomError.BadRequestError("Invalid payment response");
    }

    // Find order by transactionId (reference)
    const order = await Order.findOne({ "paymentInfo.transactionId": reference }).session(session);
    
    if (!order) {
      throw new CustomError.NotFoundError(`Order not found with reference: ${reference}`);
    }

    if (!order.orderItems || order.orderItems.length === 0) {
      throw new CustomError.BadRequestError("Order has no items");
    }

    // Check if payment is already completed to prevent double processing
    if (order.paymentInfo.paymentStatus === "completed") {
      await session.commitTransaction();
      session.endSession();
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Payment already verified",
        order,
      });
    }

    // Check payment status from Paystack
    if (paymentData.status !== "success") {
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

    // Check if amount paid matches order total or initial payment
    const amountPaid = paymentData.amount / 100; // Paystack returns amount in kobo
    const expectedAmount = order.paymentInfo.balanceDue > 0
      ? order.totalPrice - order.paymentInfo.amountPaid // For final payment
      : order.totalPrice; // For initial payment

    // Allow small tolerance for floating point differences
    if (Math.abs(amountPaid - expectedAmount) > 1) { // More than 1 unit difference
      throw new CustomError.BadRequestError(
        `Amount paid (${amountPaid}) does not match required amount (${expectedAmount})`
      );
    }

    // Update order status based on payment
    if (order.paymentInfo.balanceDue > 0) {
      // This is a final payment for custom order
      order.paymentInfo.amountPaid += amountPaid;
      order.paymentInfo.balanceDue = 0;
      order.paymentInfo.paymentStatus = "completed";
    } else {
      // This is initial payment
      order.paymentInfo.amountPaid = amountPaid;
      order.paymentInfo.paymentStatus = "completed";
    }

    order.paymentInfo.paymentDate = new Date();
    order.orderStatus = "processing";

    // Reduce product stock for standard orders (only if not already reduced)
    const isStandardOrder = order.orderItems.every((item) => item.orderType === "standard");
    if (isStandardOrder) {
      for (const item of order.orderItems) {
        const product = await Product.findById(item.product).session(session);
        if (!product) {
          throw new CustomError.NotFoundError(`Product not found: ${item.product}`);
        }
        
        // Check if stock was already reduced (to prevent double deduction)
        if (product.stock >= item.quantity) {
          product.stock -= item.quantity;
          await product.save({ session });
        }
      }
    }

    await order.save({ session });

    // Clear cart and cache
    await Cart.findOneAndDelete({ user: order.customer }).session(session);
    
    // Use Promise.allSettled instead of Promise.all to handle individual failures
    await Promise.allSettled([
      clearCache(`user:${order.customer}:orders*`),
      clearCache(`cart:${order.customer}`),
      ...order.orderItems
        .map((item) => (item.stylist ? clearCache(`stylist:${item.stylist}:orders*`) : null))
        .filter(Boolean),
    ]);

    await session.commitTransaction();
    session.endSession();

    // Notify stylists and admin (do this after transaction is committed)
    try {
      const customer = await User.findById(order.customer).select("name email").lean();
      const customerName = customer?.name || "Customer";

      // Admin notification
      const adminNotification = {
        type: "new_order",
        message: `New order #${order.orderNumber || order._id.toString().slice(-8)} (N${order.totalPrice})`,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber || order._id.toString().slice(-8),
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
          message: `New order for your products (Order #${order.orderNumber || order._id.toString().slice(-8)})`,
          data: {
            orderId: order._id,
            orderNumber: order.orderNumber || order._id.toString().slice(-8),
            customerName,
            items: data.items,
            timestamp: new Date(),
          },
        };
        emitNotification(req.io, "newNotification", stylistNotification, stylistId);
      }

      // Send email to customer
      await sendPlacedOrderEmail({
        name: customer?.name || "Customer",
        email: customer?.email,
        origin: process.env.ORIGIN,
        payload: order,
      });
    } catch (notificationError) {
      // Log notification errors but don't fail the request
      console.error("Notification error:", notificationError);
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Payment verified successfully",
      order,
    });
  } catch (error) {
    // Only abort transaction if it's still active
    try {
      // Check if session is still in a transaction and not ended
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
    } catch (abortError) {
      console.error("Error aborting transaction:", abortError);
    } finally {
      session.endSession();
    }
    
    next(error);
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
      (item) => item._id.toString() === itemId && item.stylist.toString() === userId.toString(),
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

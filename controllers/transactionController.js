const Transaction = require("../models/transactionModel");
const User = require("../models/userModel");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const mongoose = require("mongoose");
const paystack = require("paystack-api")(process.env.PAYSTACK_SECRET_KEY);
const crypto = require("crypto");

const fundWallet = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, description } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    // Validate input
    if (!amount || amount <= 0) {
      throw new CustomError.BadRequestError("Please provide a valid positive amount");
    }

    // Minimum amount check (Paystack minimum is typically 100 Naira/1 USD)
    if (amount < 100) {
      throw new CustomError.BadRequestError("Minimum wallet credit amount is 100");
    }

    // Maximum amount check
    if (amount > 1000000) {
      throw new CustomError.BadRequestError("Maximum wallet credit amount is 1,000,000");
    }

    // Find user
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }

    // Generate unique reference
    const reference = `WALLET_${userId}_${Date.now()}`;

    // Initialize Paystack payment
    const paystackResponse = await paystack.transaction.initialize({
      email: userEmail,
      amount: Math.round(amount * 100), // Convert to kobo
      reference: reference,
      callback_url: `${process.env.FRONTEND_URL}/wallet/verify?reference=${reference}`,
      metadata: {
        custom_fields: [
          {
            display_name: "User ID",
            variable_name: "user_id",
            value: userId.toString(),
          },
          {
            display_name: "Purpose",
            variable_name: "purpose",
            value: "wallet_funding",
          },
        ],
        purpose: "wallet_funding",
        user_id: userId.toString(),
        description: description || "Wallet credit",
      },
      channels: ["card", "bank", "ussd", "qr", "mobile_money"],
    });

    if (!paystackResponse.status) {
      throw new CustomError.BadRequestError(
        `Payment initialization failed: ${paystackResponse.message || "Unknown error"}`
      );
    }

    // Create a pending transaction record
    const transaction = await Transaction.create(
      [
        {
          user: userId,
          amount,
          type: "credit",
          previousBalance: user.walletBalance,
          currentBalance: user.walletBalance,
          reference: paystackResponse.data.reference,
          description: description || "Wallet funding initiated",
          status: "pending",
          metadata: {
            payment_gateway: "paystack",
            authorization_url: paystackResponse.data.authorization_url,
            access_code: paystackResponse.data.access_code,
            purpose: "wallet_funding",
            initialized_at: new Date(),
          },
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Payment initialization successful",
      authorizationUrl: paystackResponse.data.authorization_url,
      reference: paystackResponse.data.reference,
      accessCode: paystackResponse.data.access_code,
      transaction: transaction[0],
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const verifyWalletFunding = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reference } = req.body;
    const userId = req.user.id;

    if (!reference) {
      throw new CustomError.BadRequestError("Payment reference is required");
    }

    // Check if transaction is already completed (via webhook)
    const existingTransaction = await Transaction.findOne({
      reference,
      user: userId,
      status: "completed",
    }).session(session);

    if (existingTransaction) {
      await session.abortTransaction();

      // Get current user balance
      const user = await User.findById(userId);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Payment already verified",
        newBalance: user.walletBalance,
        transaction: existingTransaction,
        verifiedBy: "webhook", // Indicate it was already verified automatically
      });
    }

    // Verify payment with Paystack
    const verificationResponse = await paystack.transaction.verify(reference);

    if (!verificationResponse.status) {
      throw new CustomError.BadRequestError(
        `Payment verification failed: ${verificationResponse.message || "Unknown error"}`
      );
    }

    const paymentData = verificationResponse.data;

    // Check if payment was successful
    if (paymentData.status !== "success") {
      throw new CustomError.BadRequestError(
        `Payment not successful. Current status: ${paymentData.status}`
      );
    }

    // Get the pending transaction
    const transaction = await Transaction.findOne({
      reference,
      user: userId,
      status: "pending",
    }).session(session);

    if (!transaction) {
      throw new CustomError.NotFoundError("Pending transaction not found");
    }

    // Verify the amount matches
    const amountPaid = paymentData.amount / 100;
    if (amountPaid !== transaction.amount) {
      throw new CustomError.BadRequestError(
        `Amount paid (${amountPaid}) does not match expected amount (${transaction.amount})`
      );
    }

    // Get the user
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }

    // Update wallet balance
    const previousBalance = user.walletBalance;
    user.walletBalance += amountPaid;
    await user.save({ session });

    // Update transaction status
    transaction.status = "completed";
    transaction.previousBalance = previousBalance;
    transaction.currentBalance = user.walletBalance;
    transaction.metadata.verification = paymentData;
    transaction.metadata.verified_at = new Date();
    transaction.metadata.verified_by = "manual";
    await transaction.save({ session });

    await session.commitTransaction();

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Wallet funded successfully",
      newBalance: user.walletBalance,
      transaction,
      verifiedBy: "manual",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

//call by paystack
const handlePaymentWebhook = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Verify webhook is from Paystack
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers["x-paystack-signature"];

    if (!signature) {
      throw new CustomError.BadRequestError("No signature provided");
    }

    // Validate webhook signature
    const hash = crypto.createHmac("sha512", secret).update(JSON.stringify(req.body)).digest("hex");

    if (hash !== signature) {
      throw new CustomError.BadRequestError("Invalid signature");
    }

    const event = req.body;
    console.log(`Webhook received: ${event.event}`, event.data.reference);

    // Process different webhook events
    switch (event.event) {
      case "charge.success":
        await handleSuccessfulCharge(event.data, session);
        break;

      case "charge.failed":
        await handleFailedCharge(event.data, session);
        break;

      case "transfer.success":
        await handleTransferSuccess(event.data, session);
        break;

      case "transfer.failed":
        await handleTransferFailed(event.data, session);
        break;

      default:
        console.log(`Unhandled webhook event: ${event.event}`);
    }

    await session.commitTransaction();

    // Send response to Paystack immediately to acknowledge receipt
    res.status(StatusCodes.OK).json({
      success: true,
      message: "Webhook processed successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Webhook processing error:", error);

    // Still return 200 to Paystack to avoid retries for non-transient errors
    res.status(StatusCodes.OK).json({
      success: false,
      message: "Webhook processing failed but acknowledged",
    });
  } finally {
    session.endSession();
  }
};

//   Handle successful charge webhook

const handleSuccessfulCharge = async (paymentData, session) => {
  const reference = paymentData.reference;

  // Find the pending transaction
  const transaction = await Transaction.findOne({
    reference,
    status: "pending",
  }).session(session);

  if (!transaction) {
    throw new CustomError.NotFoundError(`No pending transaction found for reference: ${reference}`);
  }

  // Check if already processed
  if (transaction.status === "completed") {
    console.log(`Transaction already completed for reference: ${reference}`);
    return;
  }

  // Verify the amount matches
  const amountPaid = paymentData.amount / 100;
  if (amountPaid !== transaction.amount) {
    console.error(
      `Amount mismatch for reference ${reference}: Expected ${transaction.amount}, Got ${amountPaid}`
    );
    // Still process but log the discrepancy
  }

  // Get the user
  const user = await User.findById(transaction.user).session(session);
  if (!user) {
    throw new CustomError.NotFoundError("User not found for transaction");
  }

  // Update wallet balance
  const previousBalance = user.walletBalance;
  user.walletBalance += amountPaid;
  await user.save({ session });

  // Update transaction status
  transaction.status = "completed";
  transaction.previousBalance = previousBalance;
  transaction.currentBalance = user.walletBalance;
  transaction.metadata.verification = paymentData;
  transaction.metadata.verified_at = new Date();
  transaction.metadata.verified_by = "webhook";
  await transaction.save({ session });

  console.log(
    `✅ Payment automatically verified for reference: ${reference}, User: ${user.email}, Amount: ${amountPaid}`
  );

  // Here you can also:
  // - Send email notification
  // - Send push notification
  // - Update any related orders/services
};

//   Handle failed charge webhook

const handleFailedCharge = async (paymentData, session) => {
  const reference = paymentData.reference;

  const transaction = await Transaction.findOne({
    reference,
    status: "pending",
  }).session(session);

  if (transaction) {
    transaction.status = "failed";
    transaction.metadata.failure_reason = paymentData.gateway_response || "Payment failed";
    transaction.metadata.verified_at = new Date();
    await transaction.save({ session });

    console.log(`❌ Payment failed for reference: ${reference}`);
  }
};

//    Handle transfer success webhook

const handleTransferSuccess = async (transferData, session) => {
  // Handle successful transfers (for when you implement withdrawals)
  console.log(`Transfer successful: ${transferData.reference}`);
};

//   Handle transfer failed webhook

const handleTransferFailed = async (transferData, session) => {
  // Handle failed transfers (for when you implement withdrawals)
  console.log(`Transfer failed: ${transferData.reference}`);
};

/**
 * @desc    Check payment status (for frontend polling)
 * @route   POST /api/transactions/check-status
 * @access  Private
 */
const checkPaymentStatus = async (req, res, next) => {
  try {
    const { reference } = req.body;
    const userId = req.user.id;

    if (!reference) {
      throw new CustomError.BadRequestError("Payment reference is required");
    }

    // Check transaction in database first
    const transaction = await Transaction.findOne({
      reference,
      user: userId,
    });

    if (!transaction) {
      throw new CustomError.NotFoundError("Transaction not found");
    }

    // If already completed via webhook
    if (transaction.status === "completed") {
      const user = await User.findById(userId);
      return res.status(StatusCodes.OK).json({
        success: true,
        status: "completed",
        message: "Payment already verified",
        newBalance: user.walletBalance,
        transaction,
        verifiedBy: transaction.metadata?.verified_by || "unknown",
      });
    }

    // If failed
    if (transaction.status === "failed") {
      return res.status(StatusCodes.OK).json({
        success: false,
        status: "failed",
        message: "Payment failed",
        transaction,
      });
    }

    // If still pending, verify with Paystack
    const verificationResponse = await paystack.transaction.verify(reference);

    if (!verificationResponse.status) {
      return res.status(StatusCodes.OK).json({
        success: true,
        status: "pending",
        message: "Payment still processing",
        transaction,
      });
    }

    const paymentData = verificationResponse.data;

    if (paymentData.status === "success") {
      return res.status(StatusCodes.OK).json({
        success: true,
        status: "success",
        message: "Payment verified successfully",
        shouldVerify: true, // Tell frontend to call verify endpoint
        transaction,
      });
    } else if (paymentData.status === "failed") {
      return res.status(StatusCodes.OK).json({
        success: false,
        status: "failed",
        message: "Payment failed",
        transaction,
      });
    } else {
      return res.status(StatusCodes.OK).json({
        success: true,
        status: "pending",
        message: "Payment still processing",
        transaction,
      });
    }
  } catch (error) {
    next(error);
  }
};

const getAllTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, type, status, startDate, endDate, user: userId } = req.query;

    const query = {};

    // Filter by type
    if (type) query.type = type;

    // Filter by status
    if (status) query.status = status;

    // Filter by user
    if (userId) query.user = userId;

    // Filter by date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate("user", "name email");

    const total = await Transaction.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    res.status(StatusCodes.OK).json({
      success: true,
      count: transactions.length,
      total,
      totalPages,
      currentPage: parseInt(page),
      transactions,
    });
  } catch (error) {
    next(error);
  }
};

const getCurrentUserTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, type, status, startDate, endDate } = req.query;

    const query = { user: userId };

    if (type) query.type = type;
    if (status) query.status = status;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Transaction.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    res.status(StatusCodes.OK).json({
      success: true,
      count: transactions.length,
      total,
      totalPages,
      currentPage: parseInt(page),
      transactions,
    });
  } catch (error) {
    next(error);
  }
};

const getUserTransactions = async (req, res, next) => {
  try {
    const userId = req.params.userId;
    const { page = 1, limit = 10, type, status, startDate, endDate } = req.query;

    const query = { user: userId };

    if (type) query.type = type;
    if (status) query.status = status;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate("user", "name email");

    const total = await Transaction.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    res.status(StatusCodes.OK).json({
      success: true,
      count: transactions.length,
      total,
      totalPages,
      currentPage: parseInt(page),
      transactions,
    });
  } catch (error) {
    next(error);
  }
};
const getTransactionDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    let query = { _id: id };

    // Non-admin users can only see their own transactions
    if (userRole !== "admin") {
      query.user = userId;
    }

    const transaction = await Transaction.findOne(query).populate("user", "name email");

    if (!transaction) {
      throw new CustomError.NotFoundError(`Transaction not found with id: ${id}`);
    }

    res.status(StatusCodes.OK).json({
      success: true,
      transaction,
    });
  } catch (error) {
    next(error);
  }
};

const getWalletBalance = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select("walletBalance name email");
    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }

    // Get recent transactions for context
    const recentTransactions = await Transaction.find({
      user: userId,
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("type amount status description createdAt");

    res.status(StatusCodes.OK).json({
      success: true,
      balance: user.walletBalance,
      user: {
        name: user.name,
        email: user.email,
      },
      recentTransactions,
    });
  } catch (error) {
    next(error);
  }
};
const getTransactionStatistics = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Total transactions count
    const totalTransactions = await Transaction.countDocuments(dateFilter);

    // Successful transactions
    const successfulTransactions = await Transaction.countDocuments({
      ...dateFilter,
      status: "completed",
    });

    // Failed transactions
    const failedTransactions = await Transaction.countDocuments({
      ...dateFilter,
      status: "failed",
    });

    // Pending transactions
    const pendingTransactions = await Transaction.countDocuments({
      ...dateFilter,
      status: "pending",
    });

    // Total volume
    const revenueResult = await Transaction.aggregate([
      { $match: { ...dateFilter, status: "completed", type: "credit" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalVolume = revenueResult.length > 0 ? revenueResult[0].total : 0;

    // Recent activity
    const recentTransactions = await Transaction.find(dateFilter)
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("user", "name email");

    res.status(StatusCodes.OK).json({
      success: true,
      statistics: {
        totalTransactions,
        successfulTransactions,
        failedTransactions,
        pendingTransactions,
        totalVolume,
        successRate: totalTransactions > 0 ? (successfulTransactions / totalTransactions) * 100 : 0,
      },
      recentActivity: recentTransactions,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  fundWallet,
  verifyWalletFunding,
  handlePaymentWebhook,
  checkPaymentStatus,
  getAllTransactions,
  getUserTransactions,
  getCurrentUserTransactions,
  getTransactionDetail,
  getWalletBalance,
  getTransactionStatistics,
};

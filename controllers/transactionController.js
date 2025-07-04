const Transaction = require("../models/transactionModel");
const User = require("../models/userModel");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const mongoose = require("mongoose");
const paystack = require("paystack-api")(process.env.PAYSTACK_SECRET_KEY);

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

    // Find user
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }

    // Initialize Paystack payment
    const paystackResponse = await paystack.transaction.initialize({
      email: userEmail,
      amount: Math.round(amount * 100), // Paystack amounts are in kobo
      //   reference: reference || `wallet-funding-${Date.now()}`,
      callback_url: `${process.env.FRONTEND_URL}/wallet/verify`,
      metadata: {
        user_id: userId.toString(),
        purpose: "wallet_funding",
        description: description || "Wallet credit",
      },
      channels: ["card", "bank", "ussd", "qr", "mobile_money"],
    });

    if (!paystackResponse.status) {
      throw new CustomError.BadRequestError(
        "Payment initialization failed: " + (paystackResponse.message || "Unknown error")
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

    // Verify payment with Paystack
    const verificationResponse = await paystack.transaction.verify(reference);

    if (!verificationResponse.status) {
      throw new CustomError.BadRequestError("Payment verification failed");
    }

    // Check if payment was successful
    if (verificationResponse.data.status !== "success") {
      throw new CustomError.BadRequestError("Payment not successful");
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
    const amountPaid = verificationResponse.data.amount / 100;
    if (amountPaid !== transaction.amount) {
      throw new CustomError.BadRequestError("Amount paid does not match expected amount");
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
    transaction.metadata.verification = verificationResponse.data;
    await transaction.save({ session });

    await session.commitTransaction();

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Wallet funded successfully",
      newBalance: user.walletBalance,
      transaction,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const getAllTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, type, status } = req.query;

    const query = {};
    if (type) query.type = type;
    if (status) query.status = status;

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("user", "name email");

    const count = await Transaction.countDocuments(query);

    res.status(StatusCodes.OK).json({
      success: true,
      count,
      transactions,
    });
  } catch (error) {
    next(error);
  }
};

const getCurrentUserTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, type, status } = req.query;

    const query = { user: userId };
    if (type) query.type = type;
    if (status) query.status = status;

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const count = await Transaction.countDocuments(query);

    res.status(StatusCodes.OK).json({
      success: true,
      count,
      transactions,
    });
  } catch (error) {
    next(error);
  }
};

const getUserTransactions = async (req, res, next) => {
  try {
    const userId = req.params.userId;
    const { page = 1, limit = 10, type, status } = req.query;

    const query = { user: userId };
    if (type) query.type = type;
    if (status) query.status = status;

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const count = await Transaction.countDocuments(query);

    res.status(StatusCodes.OK).json({
      success: true,
      count,
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

    const transaction = await Transaction.findOne({
      _id: id,
      user: userId,
    }).populate("user", "name email");

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

module.exports = {
  fundWallet,
  verifyWalletFunding,
  getAllTransactions,
  getUserTransactions,
  getCurrentUserTransactions,
  getTransactionDetail,
};

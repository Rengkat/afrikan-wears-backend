const Transaction = require("../models/transactionModel");
const paystack = require("paystack-api")(process.env.PAYSTACK_SECRET_KEY);
const CustomError = require("../errors");
const crypto = require("crypto");

class PaymentService {
  static async initializePayment({
    user,
    amount,
    purpose,
    description,
    reference,
    callbackUrl = null,
    metadata = {},
    channels = ["card", "bank", "ussd", "qr", "mobile_money"],
  }) {
    // Build callback URL
    const defaultCallbackUrl = `${process.env.ORIGIN}/account/user/transactions/verify?reference=${reference}`;
    const finalCallbackUrl = callbackUrl || defaultCallbackUrl;

    // Build metadata
    const finalMetadata = {
      custom_fields: [
        {
          display_name: "User ID",
          variable_name: "user_id",
          value: user.id.toString(),
        },
        {
          display_name: "Purpose",
          variable_name: "purpose",
          value: purpose,
        },
      ],
      purpose: purpose,
      user_id: user.id.toString(),
      description: description || "Payment",
      ...metadata,
    };

    // Initialize Paystack payment
    const paystackResponse = await paystack.transaction.initialize({
      email: user.email,
      amount: Math.round(amount * 100), // Convert to kobo
      reference: reference,
      callback_url: finalCallbackUrl,
      metadata: finalMetadata,
      channels: channels,
    });

    if (!paystackResponse.status) {
      throw new CustomError.BadRequestError(
        `Payment initialization failed: ${paystackResponse.message || "Unknown error"}`
      );
    }

    return {
      reference,
      authorizationUrl: paystackResponse.data.authorization_url,
      accessCode: paystackResponse.data.access_code,
      paystackResponse: paystackResponse.data,
    };
  }

  /**
   * Create a pending transaction record
   */
  static async createPendingTransaction({
    user,
    amount,
    type,
    purpose,
    description,
    reference,
    authorizationUrl,
    accessCode,
    currentBalance = 0,
    relatedModel = null,
    relatedModelId = null,
    session = null,
  }) {
    const transactionData = {
      user: user.id,
      amount,
      type,
      previousBalance: currentBalance,
      currentBalance: currentBalance,
      reference: reference,
      description: description || `${purpose} initiated`,
      status: "pending",
      metadata: {
        payment_gateway: "paystack",
        authorization_url: authorizationUrl,
        access_code: accessCode,
        purpose: purpose,
        initialized_at: new Date(),
        related_model: relatedModel,
        related_model_id: relatedModelId,
      },
    };

    const transaction = session
      ? await Transaction.create([transactionData], { session })
      : await Transaction.create(transactionData);

    return Array.isArray(transaction) ? transaction[0] : transaction;
  }

  /**
   * Verify Paystack payment
   */
  static async verifyPayment(reference) {
    const verificationResponse = await paystack.transaction.verify({
      reference: reference,
    });

    if (!verificationResponse.status) {
      throw new CustomError.BadRequestError(
        `Payment verification failed: ${verificationResponse.message || "Unknown error"}`
      );
    }

    return {
      success: verificationResponse.status,
      data: verificationResponse.data,
      rawResponse: verificationResponse,
    };
  }

  /**
   * Complete a successful payment
   */
  static async completePayment({
    transaction,
    paymentData,
    user,
    onSuccess = null,
    session = null,
  }) {
    const saveOptions = session ? { session } : {};

    const amountPaid = paymentData.amount / 100;

    // Update transaction status
    transaction.status = "completed";
    transaction.metadata.verification = paymentData;
    transaction.metadata.verified_at = new Date();
    transaction.metadata.verified_by = session ? "webhook" : "manual";

    await transaction.save(saveOptions);

    // Execute custom success logic if provided
    if (onSuccess && typeof onSuccess === "function") {
      await onSuccess({ transaction, paymentData, user, session, amountPaid });
    }

    return transaction;
  }

  /**
   * Handle failed payment
   */
  static async failPayment(transaction, failureReason = "Payment failed", session = null) {
    const saveOptions = session ? { session } : {};

    transaction.status = "failed";
    transaction.metadata.failure_reason = failureReason;
    transaction.metadata.verified_at = new Date();

    await transaction.save(saveOptions);
    return transaction;
  }

  /**
   * Validate webhook signature
   */
  static validateWebhookSignature(payload, signature) {
    const secret = process.env.PAYSTACK_SECRET_KEY;

    if (!signature) {
      throw new CustomError.BadRequestError("No signature provided");
    }

    const hash = crypto.createHmac("sha512", secret).update(JSON.stringify(payload)).digest("hex");

    if (hash !== signature) {
      throw new CustomError.BadRequestError("Invalid webhook signature");
    }

    return true;
  }

  /**
   * Check payment status (for frontend polling)
   */
  static async checkPaymentStatus(reference, userId) {
    const transaction = await Transaction.findOne({
      reference,
      user: userId,
    });

    if (!transaction) {
      throw new CustomError.NotFoundError("Transaction not found");
    }

    // Return immediately if transaction is already completed or failed
    if (transaction.status === "completed") {
      const user = await User.findById(userId);
      return {
        status: "completed",
        success: true,
        message: "Payment already verified",
        newBalance: user.walletBalance,
        transaction,
        verifiedBy: transaction.metadata?.verified_by || "unknown",
      };
    }

    if (transaction.status === "failed") {
      return {
        status: "failed",
        success: false,
        message: "Payment failed",
        transaction,
      };
    }

    // If still pending, verify with Paystack
    const verificationResponse = await paystack.transaction.verify(reference);

    if (!verificationResponse.status) {
      return {
        status: "pending",
        success: true,
        message: "Payment still processing",
        transaction,
      };
    }

    const paymentData = verificationResponse.data;

    if (paymentData.status === "success") {
      return {
        status: "success",
        success: true,
        message: "Payment verified successfully",
        shouldVerify: true,
        transaction,
      };
    } else if (paymentData.status === "failed") {
      return {
        status: "failed",
        success: false,
        message: "Payment failed",
        transaction,
      };
    } else {
      return {
        status: "pending",
        success: true,
        message: "Payment still processing",
        transaction,
      };
    }
  }
}

module.exports = PaymentService;

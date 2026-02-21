const CustomError = require("../errors");
const { isTokenVerified, attachTokenToResponse, createUserPayload } = require("../utils");
const Token = require("../models/tokenModel");
const crypto = require("crypto");
const User = require("../models/userModel");
const clearAuthCookies = require("../utils/helper/clearAuthCookies");

// Main authentication middleware
const authenticateUser = async (req, res, next) => {
  try {
    const { accessToken, refreshToken } = req.signedCookies;

    // ── Step 1: Try access token ──────────────────────────────────────────────
    if (accessToken) {
      try {
        const payload = isTokenVerified(accessToken);
        req.user = payload.accessToken;
        return next();
      } catch (error) {
        console.log("Error verifying access token:", error.message);
      }
    }

    // ── Step 2: Try refresh token ─────────────────────────────────────────────
    if (!refreshToken) {
      throw new CustomError.UnauthenticatedError("Authentication required. Please log in.");
    }

    let payload;
    try {
      payload = isTokenVerified(refreshToken);
    } catch (error) {
      clearAuthCookies(res);
      throw new CustomError.UnauthenticatedError("Session expired. Please log in again.");
    }

    const { accessToken: userPayloadFromJWT, refreshToken: rawRefreshToken } = payload;

    // Look up token — intentionally NOT filtering by isValid so we can detect reuse
    const existingToken = await Token.findOne({
      user: userPayloadFromJWT.id,
      refreshToken: rawRefreshToken,
    });

    if (!existingToken) {
      // Not in DB at all — wipe all sessions (possible breach)
      await Token.updateMany({ user: userPayloadFromJWT.id }, { isValid: false });
      clearAuthCookies(res);
      throw new CustomError.UnauthenticatedError(
        "Invalid session. All sessions have been revoked.",
      );
    }

    if (!existingToken.isValid) {
      // Already rotated/invalidated → reuse detected → possible theft
      await Token.updateMany({ user: userPayloadFromJWT.id }, { isValid: false });
      clearAuthCookies(res);
      throw new CustomError.UnauthenticatedError(
        "Token reuse detected. All sessions have been revoked for your safety.",
      );
    }

    if (existingToken.expiresAt < new Date()) {
      existingToken.isValid = false;
      await existingToken.save();
      clearAuthCookies(res);
      throw new CustomError.UnauthenticatedError("Session expired. Please log in again.");
    }

    // ── Step 3: Fetch user ────────────────────────────────────────────────────
    const user = await User.findById(userPayloadFromJWT.id).select("-password");
    if (!user) {
      clearAuthCookies(res);
      throw new CustomError.UnauthenticatedError("User not found. Please log in again.");
    }

    // ── Step 4: Rotate in place (update same doc, zero new documents) ─────────
    const newRefreshToken = crypto.randomBytes(40).toString("hex");
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 7);

    existingToken.refreshToken = newRefreshToken;
    existingToken.lastUsed = new Date();
    existingToken.expiresAt = newExpiresAt;
    existingToken.deviceInfo = {
      ...existingToken.deviceInfo,
      ip: req.ip,
    };
    await existingToken.save();

    const userPayload = createUserPayload(user);
    attachTokenToResponse({ res, userPayload, refreshToken: newRefreshToken });

    req.user = userPayload;
    return next();
  } catch (error) {
    next(error);
  }
};

// Generic authorization middleware
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      throw new CustomError.UnauthorizedError(
        `Unauthorized. Allowed roles: ${allowedRoles.join(", ")}`,
      );
    }
    next();
  };
};

// Admin authorization
const adminAuthorization = (req, res, next) => {
  if (req.user.role !== "admin") {
    throw new CustomError.UnauthorizedError("Admin access required");
  }
  next();
};

// Stylist authorization
const stylistAuthorization = (req, res, next) => {
  if (req.user.role !== "stylist") {
    throw new CustomError.UnauthorizedError("Stylist access required");
  }
  next();
};

// Customer authorization
const customerAuthorization = (req, res, next) => {
  if (req.user.role !== "user") {
    throw new CustomError.UnauthorizedError("Customer access required");
  }
  next();
};

const checkStylistOwnership = (req, res, next) => {
  const { id } = req.params;
  const { role, company } = req.user;

  // Admin can access any stylist
  if (role === "admin") {
    return next();
  }

  // If not a stylist, cannot access stylist resources
  if (role !== "stylist") {
    throw new CustomError.UnauthorizedError("Only stylists can access this resource");
  }

  // Check if stylist is accessing their own company
  if (!company || company.toString() !== id) {
    throw new CustomError.UnauthorizedError("You can only access your own company");
  }

  next();
};

// Optional: Combined authorization (for backward compatibility)
const adminAndStylistAuthorization = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      throw new CustomError.UnauthorizedError("You are not authorized!");
    }
    next();
  };
};

module.exports = {
  authenticateUser,
  authorize,
  adminAuthorization,
  stylistAuthorization,
  customerAuthorization,
  adminAndStylistAuthorization,
  checkStylistOwnership,
  clearAuthCookies,
};

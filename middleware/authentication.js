const CustomError = require("../errors");
const { isTokenVerified, attachTokenToResponse, createUserPayload } = require("../utils");
const Token = require("../models/tokenModel");
const crypto = require("crypto");
const User = require("../models/userModel");

// Main authentication middleware
const authenticateUser = async (req, res, next) => {
  try {
    const { accessToken, refreshToken } = req.signedCookies;

    // Try access token first
    if (accessToken) {
      try {
        const payload = isTokenVerified(accessToken);
        req.user = payload.accessToken;
        return next();
      } catch (accessTokenError) {
        console.log("Access token expired or invalid:", accessTokenError.message);
        // Continue to refresh token logic
      }
    }

    // Try refresh token if access token is invalid/missing
    if (refreshToken) {
      try {
        const payload = isTokenVerified(refreshToken);

        const existingRefreshToken = await Token.findOne({
          user: payload.accessToken.id,
          refreshToken: payload.refreshToken,
          isValid: true,
        });

        if (!existingRefreshToken) {
          console.log("No valid refresh token found in database");
          throw new CustomError.UnauthenticatedError("Session expired. Please log in again.");
        }

        // Refresh token is valid - rotate tokens (create new one)
        const newRefreshToken = crypto.randomBytes(40).toString("hex");

        // Create new token and invalidate old one
        await Token.create({
          refreshToken: newRefreshToken,
          user: payload.accessToken.id,
          isValid: true,
        });

        // Optionally: Invalidate old token
        existingRefreshToken.isValid = false;
        await existingRefreshToken.save();

        // Find user
        const user = await User.findById(payload.accessToken.id).select("-password");
        if (!user) {
          console.log("User not found for refresh token");
          throw new CustomError.UnauthenticatedError("User not found. Please log in again.");
        }

        const userPayload = createUserPayload(user);

        // Attach new tokens to response
        attachTokenToResponse({
          res,
          userPayload,
          refreshToken: newRefreshToken,
        });

        req.user = userPayload;
        return next();
      } catch (refreshTokenError) {
        console.log("Refresh token validation failed:", refreshTokenError.message);

        // Only clear cookies for specific JWT errors
        if (
          refreshTokenError.name === "JsonWebTokenError" ||
          refreshTokenError.name === "TokenExpiredError"
        ) {
          clearAuthCookies(res);
        }

        throw new CustomError.UnauthenticatedError("Session expired. Please log in again.");
      }
    }

    // No tokens available at all
    console.log("No authentication tokens found");
    throw new CustomError.UnauthenticatedError("Authentication required. Please log in.");
  } catch (error) {
    // Only handle specific JWT errors, let others propagate
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      clearAuthCookies(res);
      return next(new CustomError.UnauthenticatedError("Session expired. Please log in again."));
    }

    // For other errors (like database errors), don't clear cookies
    next(error);
  }
};

// Helper function to clear auth cookies
const clearAuthCookies = (res) => {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  };

  res.cookie("accessToken", "", { ...options, maxAge: 0 });
  res.cookie("refreshToken", "", { ...options, maxAge: 0 });
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

// Improved ownership check with better validation
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

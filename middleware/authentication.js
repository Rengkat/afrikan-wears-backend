const CustomError = require("../errors");
const { isTokenVerified, attachTokenToResponse } = require("../utils");
const Token = require("../models/tokenModel");
const crypto = require("crypto");

const authenticateUser = async (req, res, next) => {
  try {
    const { accessToken, refreshToken } = req.signedCookies;
    if (accessToken) {
      const payload = isTokenVerified(accessToken);
      req.user = payload.accessToken;
      return next();
    }

    if (refreshToken) {
      const payload = isTokenVerified(refreshToken);

      const existingRefreshToken = await Token.findOne({
        user: payload.accessToken.id,
        refreshToken: payload.refreshToken,
      });

      if (!existingRefreshToken || !existingRefreshToken.isValid) {
        throw new CustomError.UnauthenticatedError(
          "Authentication invalid - Refresh token invalid or expired"
        );
      }

      // Re-attach new access and refresh tokens (rotate refresh token for better security)
      // generate a NEW refresh token here for better security practices
      const newRefreshTokenString = crypto.randomBytes(40).toString("hex");
      existingRefreshToken.refreshToken = newRefreshTokenString;
      await existingRefreshToken.save();

      attachTokenToResponse({
        res,
        userPayload: payload.accessToken,
        refreshToken: newRefreshTokenString,
      });

      req.user = payload.accessToken;
      return next();
    }
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      const options = {
        httpOnly: true,
        expires: new Date(Date.now()),
        secure: process.env.NODE_ENV === "production",
      };
      res.cookie("accessToken", "logout", {
        ...options,
      });
      res.cookie("refreshToken", "logout", {
        ...options,
      });
      return next(
        new CustomError.UnauthenticatedError("Authentication invalid - Please log in again")
      );
    }
    next(error);
  }
};

const restrictToUser = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      throw new CustomError.UnauthorizedError("Only customers can perform this action");
    }
    next();
  };
};

const adminAuthorization = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      throw new CustomError.UnauthorizedError("Not authorized to access this route");
    }
    next();
  } catch (error) {
    next(error);
  }
};
const stylistAuthorization = async (req, res, next) => {
  try {
    if (req.user.role !== "stylist") {
      throw new CustomError.UnauthorizedError(
        "Not authorized to access this route. Only for stylist"
      );
    }
    next();
  } catch (error) {
    next(error);
  }
};
const adminAndStylistAuthorization = (...roles) => {
  return async (req, res, next) => {
    try {
      if (!roles.includes(req.user.role)) {
        return next(new CustomError.UnauthorizedError("You are not authorized!"));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};
module.exports = {
  authenticateUser,
  adminAuthorization,
  stylistAuthorization,
  adminAndStylistAuthorization,
  restrictToUser,
};

const User = require("../models/userModel");
const CustomError = require("../errors");
const Token = require("../models/tokenModel");
const Stylist = require("../models/stylistModel");
const { attachTokenToResponse, createUserPayload } = require("../utils");
const sendResetPasswordEmail = require("../utils/email/sendResetPasswordEmail");
const crypto = require("crypto");
const sendVerificationEmail = require("../utils/Email/sendVerificationMail");
const { StatusCodes } = require("http-status-codes");
const { clearCache } = require("../utils/redisClient");
const register = async (req, res, next) => {
  try {
    const { name, email, password, companyName } = req.body;

    // check if details are present
    if (!name || !email || !password) {
      throw new CustomError.BadRequestError("Please provide all credentials");
    }

    // check if the email exists
    const existedUser = await User.findOne({ email });
    if (existedUser) {
      throw new CustomError.BadRequestError("Sorry, email already exists");
    }

    // create verification token
    const verificationToken = crypto.randomBytes(40).toString("hex");
    const expiration = new Date(Date.now() + 1000 * 60 * 60);

    // create a user
    const userCount = await User.countDocuments();
    let company = null;

    // If companyName is provided, create the stylist first
    if (companyName) {
      company = await Stylist.create({
        name: companyName,
        description: `${name}'s styling company`,
      });
    }

    const user = await User.create({
      name,
      email,
      password,
      company: company?._id || null,
      role: userCount === 0 ? "admin" : companyName ? "stylist" : "user",
      verificationToken,
      verificationTokenExpirationDate: expiration,
    });

    // If company was created, update it with the owner reference
    if (company) {
      company.owner = user._id;
      await company.save();
    }

    // send verification token email
    sendVerificationEmail({
      email: user.email,
      origin: process.env.ORIGIN,
      name: user.name,
      verificationToken,
    });

    res.status(StatusCodes.CREATED).json({
      message: "Account created successfully. Kindly verify your email",
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: company || null,
      },
    });
  } catch (error) {
    next(error);
  }
};
const verifyEmail = async (req, res, next) => {
  try {
    const { email, verificationToken } = req.body;
    // check if details are passed
    if (!email || !verificationToken) {
      throw new CustomError.BadRequestError("Please provide all details");
    }
    // find user based on email
    const user = await User.findOne({ email });
    // check if user
    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }
    // check expiring of verify code and return
    if (new Date() > user.verificationTokenExpirationDate) {
      throw new CustomError.BadRequestError(
        "Verification token has expired. Please request a new one."
      );
    }
    // check if verification code is same
    if (user.verificationToken !== verificationToken) {
      throw new CustomError.BadRequestError("Invalid token");
    }
    // set user as verify and clear verification
    user.isVerified = true;
    user.verificationToken = null;
    user.verificationTokenExpirationDate = null;
    await user.save();
    //return res
    const cacheKey = `users*`;
    await clearCache(cacheKey);
    res.status(StatusCodes.OK).json({
      message: "Email verification successful.",
      success: true,
    });
  } catch (error) {
    next(error);
  }
};
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Check if details are provided
    if (!email || !password) {
      throw new CustomError.BadRequestError("Please provide email and password");
    }

    // Check if user exists with email
    const user = await User.findOne({ email });
    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }

    // Check if password is correct
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      throw new CustomError.UnauthenticatedError("Password wrong! Please enter correct password");
    }

    // Check if user is verified
    if (!user.isVerified) {
      throw new CustomError.UnauthenticatedError("Please verify your email");
    }

    // Create access token
    const userPayload = createUserPayload(user);
    let refreshToken;
    // Check if refresh token exists
    const refreshTokenExist = await Token.findOne({ user: user._id });

    if (refreshTokenExist) {
      if (!refreshTokenExist.isValid) {
        throw new CustomError.UnauthenticatedError("Invalid credentials");
      }
      refreshToken = refreshTokenExist.refreshToken;
    } else {
      // If refresh token does not exist, create one
      refreshToken = crypto.randomBytes(40).toString("hex");
      const ip = req.ip;
      const userAgent = req.headers["user-agent"];
      const refreshTokenPayload = { refreshToken, ip, userAgent, user: user._id };
      await Token.create(refreshTokenPayload);
    }

    // Attach tokens to response
    attachTokenToResponse({ res, userPayload, refreshToken });
    res.status(StatusCodes.OK).json({
      success: true,
      user: userPayload,
      message: "Logged in successfully",
    });
  } catch (error) {
    next(error);
  }
};
const googleAuth = async (req, res, next) => {
  try {
    if (!req.user) {
      throw new CustomError.UnauthenticatedError("Google authentication failed");
    }

    const { refreshToken, ...userPayload } = req.user;

    // Attach tokens to response
    attachTokenToResponse({ res, userPayload, refreshToken });

    res.status(StatusCodes.OK).json({
      success: true,
      user: userPayload,
      message: "Logged in successfully with Google",
    });
  } catch (error) {
    next(error);
  }
};
const logout = async (req, res, next) => {
  try {
    const userId = req.user.id;
    if (!userId) {
      throw new CustomError.UnauthenticatedError("Not authenticated");
    }

    // Invalidate the refresh token in the database
    await Token.findOneAndUpdate({ user: userId }, { isValid: false }, { new: true });

    res.cookie("accessToken", "logout", {
      httpOnly: true,
      expires: new Date(Date.now()),
      secure: process.env.NODE_ENV === "production",
    });

    res.cookie("refreshToken", "logout", {
      httpOnly: true,
      expires: new Date(Date.now()),
      secure: process.env.NODE_ENV === "production",
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
};
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      throw new CustomError.BadRequestError("Please provide email");
    }
    const user = await User.findOne({ email });
    const resetToken = crypto.randomBytes(70).toString("hex");
    const expirationDate = new Date(Date.now() + 1000 * 60 * 60);
    if (user) {
      user.verificationToken = resetToken;
      user.verificationTokenExpirationDate = expirationDate;
      await user.save();

      await sendResetPasswordEmail({
        email: user.email,
        origin: process.env.ORIGIN,
        verificationToken: user.verificationToken,
        name: user.name,
      });
    }
    res
      .status(StatusCodes.OK)
      .json({ message: "Please check your email to set your password", success: true });
  } catch (error) {
    next(error);
  }
};
const resetPassword = async (req, res, next) => {
  try {
    const { email, verificationToken, password } = req.body;
    if (!email || !verificationToken || !password) {
      throw new CustomError.BadRequestError("Please provide all credentials");
    }

    const user = await User.findOne({ email });
    if (user) {
      if (verificationToken !== user.verificationToken) {
        throw new CustomError.BadRequestError("Verification failed");
      }
      if (new Date() > user.verificationTokenExpirationDate) {
        throw new CustomError.BadRequestError("Verification code expired. Please reverify");
      }
      user.password = password;
      user.verificationToken = null;
      user.verificationTokenExpirationDate = null;
      await user.save();
    }
    res.status(StatusCodes.OK).json({ message: "Password successfully reset", success: true });
  } catch (error) {
    next(error);
  }
};
module.exports = {
  register,
  verifyEmail,
  login,
  googleAuth,
  logout,
  forgotPassword,
  resetPassword,
};

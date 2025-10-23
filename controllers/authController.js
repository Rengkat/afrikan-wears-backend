const User = require("../models/userModel");
const CustomError = require("../errors");
const Token = require("../models/tokenModel");
const Stylist = require("../models/stylistModel");
const { attachTokenToResponse, createUserPayload, isTokenVerified } = require("../utils");
const sendResetPasswordEmail = require("../utils/email/sendResetPasswordEmail");
const crypto = require("crypto");
const sendVerificationEmail = require("../utils/Email/sendVerificationMail");
const { StatusCodes } = require("http-status-codes");
const { clearCache } = require("../utils/redisClient");
const register = async (req, res, next) => {
  try {
    const { firstName, surname, email, password, companyName } = req.body;
    // check if details are present
    if (!firstName || !surname || !email || !password) {
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
        companyName: companyName,
        description: `${firstName} ${surname}'s styling company`,
      });
    }

    const user = await User.create({
      firstName,
      surname,
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
      name: user.firstName,
      verificationToken,
    });

    res.status(StatusCodes.CREATED).json({
      message: "Account created successfully. Kindly verify your email",
      success: true,
      user: {
        _id: user._id,
        firstName: user.firstName,
        surname: user.surname,
        email: user.email,
        role: user.role,
        company: company || null,
      },
    });
  } catch (error) {
    next(error);
  }
};
const resendVerificationEmail = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new CustomError.BadRequestError("Please provide email");
    }

    const user = await User.findOne({ email });

    if (!user) {
      throw new CustomError.NotFoundError("No user found with this email");
    }

    if (user.isVerified) {
      throw new CustomError.BadRequestError("Email is already verified");
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(40).toString("hex");
    const expiration = new Date(Date.now() + 1000 * 60 * 60);

    user.verificationToken = verificationToken;
    user.verificationTokenExpirationDate = expiration;
    await user.save();

    // Send verification email
    await sendVerificationEmail({
      email: user.email,
      origin: process.env.ORIGIN,
      name: user.firstName,
      verificationToken,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Verification email sent successfully",
      // Optionally include these for debugging (remove in production)
      debug:
        process.env.NODE_ENV === "development"
          ? {
              verificationToken,
              expiresAt: expiration,
            }
          : undefined,
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
      throw new CustomError.UnauthenticatedError("Invalid email or password");
    }

    // Check if password is correct
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      throw new CustomError.UnauthenticatedError("Invalid email or password");
    }

    // Check if user is verified
    if (!user.isVerified) {
      throw new CustomError.UnauthenticatedError("Please verify your email");
    }

    // Create access token
    const userPayload = createUserPayload(user);
    let refreshToken;

    // Check if refresh token exists and is valid
    const existingToken = await Token.findOne({ user: user._id });

    if (existingToken && existingToken.isValid) {
      // Use existing valid token
      refreshToken = existingToken.refreshToken;
    } else {
      // If no valid token exists, create a new one
      refreshToken = crypto.randomBytes(40).toString("hex");
      const ip = req.ip;
      const userAgent = req.headers["user-agent"];

      if (existingToken) {
        // Update existing invalid token
        existingToken.refreshToken = refreshToken;
        existingToken.isValid = true;
        existingToken.ip = ip;
        existingToken.userAgent = userAgent;
        await existingToken.save();
      } else {
        // Create new token
        await Token.create({
          refreshToken,
          ip,
          userAgent,
          user: user._id,
        });
      }
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
const getCurrentUser = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Add population if you need related data (like company info)
    const user = await User.findById(userId)
      .select("-password -verificationToken -verificationTokenExpirationDate -__v")
      .populate({
        path: "company",
        select: "companyName description",
      });

    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }

    res.status(StatusCodes.OK).json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        surname: user.surname,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        company: user.company || null,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    next(error);
  }
};
// for nextjs middleware
const validateTokens = async (req, res, next) => {
  try {
    // Your existing authenticateUser middleware logic
    const { accessToken, refreshToken } = req.signedCookies;

    if (accessToken) {
      const payload = isTokenVerified(accessToken);
      return res.status(StatusCodes.OK).json({ valid: true, user: payload.accessToken });
    }

    if (refreshToken) {
      try {
        const payload = isTokenVerified(refreshToken);
        const existingToken = await Token.findOne({
          user: payload.accessToken.id,
          refreshToken: payload.refreshToken,
          isValid: true,
        });

        if (existingToken) {
          return res.status(StatusCodes.OK).json({ valid: true, user: payload.accessToken });
        }
      } catch (error) {
        throw CustomError.UnauthenticatedError("Invalid tokens");
      }
    }

    return res.status(StatusCodes.FORBIDDEN).json({ valid: false, error: "Invalid tokens" });
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
    console.log("Forgot password request received here", email);
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
        name: user.firstName,
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
    console.log("Reset password request received here", email, verificationToken, password);
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
const refreshTokens = async (req, res, next) => {
  try {
    const { refreshToken: incomingRefreshToken } = req.signedCookies;

    if (!incomingRefreshToken) {
      throw new CustomError.UnauthenticatedError("No refresh token provided");
    }

    // 2. Verify the JWT refresh token
    let payload;
    try {
      payload = isTokenVerified(incomingRefreshToken);
    } catch (jwtError) {
      throw new CustomError.UnauthenticatedError("Invalid or expired refresh token");
    }

    // 3. Find the matching token in database
    const existingToken = await Token.findOne({
      user: payload.accessToken.id,
      refreshToken: payload.refreshToken,
      isValid: true,
    });

    if (!existingToken) {
      throw new CustomError.UnauthenticatedError("Invalid session - token not found");
    }

    // 4. Get the associated user
    const user = await User.findById(payload.accessToken.id);
    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }

    // 5. Rotate refresh token (generate new one, invalidate old)
    const newRefreshToken = crypto.randomBytes(40).toString("hex");
    existingToken.refreshToken = newRefreshToken;
    await existingToken.save();

    // 6. Create and attach new tokens
    const userPayload = createUserPayload(user);
    attachTokenToResponse({
      res,
      userPayload,
      refreshToken: newRefreshToken,
    });

    // 7. Return success response with user data
    res.status(StatusCodes.OK).json({
      success: true,
      user: userPayload,
      message: "Tokens refreshed successfully",
    });
  } catch (error) {
    // Clear cookies on any error
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

    next(error);
  }
};
module.exports = {
  register,
  resendVerificationEmail,
  verifyEmail,
  login,
  getCurrentUser,
  // googleAuth,
  logout,
  forgotPassword,
  resetPassword,
  refreshTokens,
  validateTokens,
};

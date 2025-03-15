const User = require("../models/userModel");
const CustomError = require("../errors");
const Token = require("../models/tokenModel");
const { attachTokenToResponse } = require("../utils");
const sendResetPasswordEmail = require("../utils/email/sendResetPasswordEmail");
const register = async (req, res, next) => {
  try {
    const { name, email, password, company } = req.body;
    // check if details are present
    if (!name || !email || !password) {
      throw new CustomError.BadRequestError("Please provide all credentials");
    }
    // check if the email exist
    const existedUser = await User.findOne({ email });
    if (existedUser) {
      throw new CustomError.BadRequestError("Sorry, email already exist");
    }
    // create verification token
    const verificationToken = crypto.randomBytes(40).toString("hex");
    const expiration = new Date(new Date.now() + 1000 * 60 * 60);
    // create a user
    const user = await User.create({
      name,
      email,
      password,
      company,
      verificationToken,
      verificationTokenExpirationDate: expiration,
    });
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
    const isPasswordCorrect = await user.comparePassword(password); // Await this
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
      const refreshTokenPayload = { refreshToken, ip, userAgent, user: user._id }; // Include user ID
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
const logout = async (req, res, next) => {};
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
  logout,
  forgotPassword,
  resetPassword,
};

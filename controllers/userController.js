const User = require("../models/userModel");
const CustomError = require("../errors");
const { StatusCodes } = require("http-status-codes");
const { setInCache, getFromCache, clearCache } = require("../utils/redisClient");
const mongoose = require("mongoose");
const { writeClient } = require("../utils");
const fs = require("fs").promises;
const getAllUsers = async (req, res, next) => {
  try {
    const { name, page = 1, limit = 10 } = req.query;
    const cacheKey = `users:${name || ""}:page:${page}:limit:${limit}`;

    // Check cache first
    const cachedData = await getFromCache(cacheKey);
    if (cachedData) {
      return res.status(StatusCodes.OK).json({
        fromCache: true,
        success: true,
        users: cachedData,
      });
    }

    // Build query
    const query = {};
    if (name) {
      query.$or = [
        { firstName: { $regex: name, $options: "i" } },
        { surname: { $regex: name, $options: "i" } },
      ];
    }

    // Execute queries in parallel
    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password -verificationToken -googleId")
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      User.countDocuments(query),
    ]);

    // Prepare response
    const responseData = {
      count: users.length,
      totalUsers: total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      users,
    };

    // Cache the result
    await setInCache(cacheKey, responseData);

    res.status(StatusCodes.OK).json({
      success: true,
      fromCache: false,
      ...responseData,
    });
  } catch (error) {
    next(error);
  }
};

const getDetailUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const cacheKey = `users:${id}`;
    const cachedData = getFromCache(cacheKey);
    if (cachedData) {
      res.status(StatusCodes.OK).json({ fromCache: true, success: true, user: cachedData });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new CustomError.BadRequestError("Invalid user ID format");
    }

    const user = await User.findById(id).select(
      "-password -verificationToken -googleId -verificationTokenExpirationDate"
    );

    if (!user) {
      throw new CustomError.NotFoundError(`User with ID ${id} not found`);
    }
    await setInCache(cacheKey, user.toObject());
    res.status(StatusCodes.OK).json({ success: true, user, fromCache: false });
  } catch (error) {
    next(error);
  }
};
const getMyProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Validate user ID format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new CustomError.BadRequestError("Invalid user ID format");
    }

    // Get user with essential fields only
    const user = await User.findById(userId)
      .select("-password -verificationToken -googleId -verificationTokenExpirationDate")
      .lean();

    if (!user) {
      throw new CustomError.NotFoundError("User profile not found");
    }

    // Add any computed fields if needed
    const profileData = {
      ...user,
      fullAddress:
        user.addresses.length > 0
          ? `${user.addresses[0].street}, ${user.addresses[0].city}, ${user.addresses[0].state}`
          : null,
    };

    res.status(StatusCodes.OK).json({
      success: true,
      profile: profileData,
    });
  } catch (error) {
    next(error);
  }
};
const updateCurrentUser = async (req, res, next) => {
  const session = await mongoose.startSession();
  let transactionFailed = false;

  try {
    session.startTransaction();
    const { firstName, surname, phone, walletAmount, subscribedToNewsLetter, address, avatar } =
      req.body;
    const userId = req.user.id;

    const user = await User.findById(userId)
      .session(session)
      .select("-password -verificationToken -googleId");

    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }

    // Update basic fields
    if (firstName) user.firstName = firstName.trim();
    if (avatar) user.avatar = avatar;
    if (surname) user.surname = surname.trim();
    if (phone) user.phone = phone;
    if (walletAmount !== undefined) user.walletAmount = walletAmount;
    if (subscribedToNewsLetter !== undefined) {
      user.subscribedToNewsLetter = subscribedToNewsLetter;
    }

    // Handle address addition
    if (address) {
      const requiredFields = ["country", "state", "city", "street", "postalCode", "homeAddress"];
      const missingFields = requiredFields.filter((field) => !address[field]);

      if (missingFields.length > 0) {
        throw new CustomError.BadRequestError(
          `Missing address fields: ${missingFields.join(", ")}`
        );
      }

      const isDuplicate = user.addresses.some((existingAddr) =>
        requiredFields.every(
          (field) =>
            existingAddr[field]?.toString().toLowerCase() ===
            address[field]?.toString().toLowerCase()
        )
      );

      if (isDuplicate) {
        throw new CustomError.BadRequestError("This address already exists");
      }

      user.addresses.push(address);
      if (user.addresses.length > 5) {
        user.addresses = user.addresses.slice(-5);
      }
    }

    await user.save({ session });
    await session.commitTransaction();

    // Clear relevant cache entries
    await Promise.all([clearCache(`users:${userId}`), clearCache(`users:*`)]);

    res.status(StatusCodes.OK).json({
      success: true,
      user: user.toObject(),
    });
  } catch (error) {
    transactionFailed = true;
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    next(error);
  } finally {
    session.endSession();
  }
};

const updateUser = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { id } = req.params;
    const { firstName, surname, email, role, addresses } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new CustomError.BadRequestError("Invalid user ID format");
    }

    const user = await User.findById(id)
      .session(session)
      .select("-password -verificationToken -googleId");

    if (!user) {
      throw new CustomError.NotFoundError(`User with ID ${id} not found`);
    }

    // Validate and update fields
    if (firstName) user.firstName = firstName.trim();
    if (surname) user.surname = surname.trim();

    if (email) {
      if (!validator.isEmail(email)) {
        throw new CustomError.BadRequestError("Please provide a valid email");
      }
      user.email = email;
    }

    if (role) {
      if (!["admin", "user", "stylist"].includes(role)) {
        throw new CustomError.BadRequestError("Invalid role specified");
      }
      user.role = role;
    }

    if (addresses) {
      if (!Array.isArray(addresses)) {
        throw new CustomError.BadRequestError("Addresses must be an array");
      }
      user.addresses = addresses;
    }

    await user.save({ session });
    await session.commitTransaction();

    const userResponse = user.toObject();
    delete userResponse.verificationTokenExpirationDate;
    await Promise.all([clearCache(`users:${id}`), clearCache(`users:*`)]);

    res.status(StatusCodes.OK).json({
      success: true,
      user: userResponse,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const deleteUser = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new CustomError.BadRequestError("Invalid user ID format");
    }

    const user = await User.findByIdAndDelete(id).session(session);
    if (!user) {
      throw new CustomError.NotFoundError(`User with ID ${id} not found`);
    }

    await session.commitTransaction();
    await Promise.all([clearCache(`users:${id}`), clearCache(`users:*`)]);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
const uploadAvatar = async (req, res, next) => {
  let tempFilePath = null;
  try {
    if (!req.files?.avatar) {
      throw new CustomError.BadRequestError("Avatar image is required");
    }

    const avatarFile = req.files.avatar;

    tempFilePath = avatarFile.tempFilePath;
    const fileBuffer = await fs.readFile(tempFilePath);

    // Upload to Sanity
    const uploadResult = await writeClient.assets.upload("image", fileBuffer, {
      filename: avatarFile.name,
      contentType: avatarFile.mimetype,
    });

    // Create reference document
    const doc = await writeClient.create({
      _type: "imageStorage",
      image: {
        _type: "image",
        asset: {
          _type: "reference",
          _ref: uploadResult._id,
        },
      },
    });

    const imageUrl = `${uploadResult.url}?w=200&h=200&fit=crop`; // Square crop for avatar

    res.status(StatusCodes.OK).json({
      success: true,
      imageUrl,
      message: "Avatar uploaded successfully",
    });
  } catch (error) {
    next(error);
  } finally {
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
      } catch (e) {
        console.error("Error deleting temp file:", e);
      }
    }
  }
};

module.exports = {
  getAllUsers,
  getDetailUser,
  updateCurrentUser,
  updateUser,
  deleteUser,
  getMyProfile,
  uploadAvatar,
};

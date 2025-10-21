const Stylist = require("../models/stylistModel");
const User = require("../models/userModel");
const { StatusCodes } = require("http-status-codes");
const { getFromCache, setInCache, clearCache } = require("../utils/redisClient");
const fs = require("fs").promises;
const CustomError = require("../errors");
const mongoose = require("mongoose");
const { writeClient } = require("../utils");
const addStylist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      company,
      description,
      owner,
      specialty,
      services,
      phone,
      location,
      cacCertificateNumber, // ADD THIS
    } = req.body;

    // Validate required fields - UPDATE VALIDATION
    if (
      !company ||
      !owner ||
      !specialty ||
      !services?.length ||
      !phone ||
      !location?.state ||
      !location?.address ||
      !cacCertificateNumber
    ) {
      throw new CustomError.BadRequestError(
        "Provide company, owner ID, specialty, services, phone, CAC certificate number, and full location (state + address)"
      );
    }

    // Check if stylist exists (case-insensitive)
    const existingStylist = await Stylist.findOne({
      company: { $regex: new RegExp(`^${company}$`, "i") },
    }).session(session);

    if (existingStylist) {
      throw new CustomError.BadRequestError("Company name already exists");
    }

    // Check if CAC certificate number already exists
    const existingCAC = await Stylist.findOne({
      cacCertificateNumber: cacCertificateNumber.trim(),
    }).session(session);

    if (existingCAC) {
      throw new CustomError.BadRequestError("CAC certificate number already registered");
    }

    const stylist = await Stylist.create(
      [
        {
          company,
          description,
          owner,
          specialty,
          services,
          phone,
          location,
          cacCertificateNumber: cacCertificateNumber.trim(),
          verificationStatus: "pending",
          isCompanyVerified: false,
        },
      ],
      { session }
    );

    // Update user role
    const user = await User.findById(owner).session(session);
    if (!user) {
      throw new CustomError.NotFoundError("User not found");
    }

    user.role = "stylist";
    user.company = stylist[0]._id;
    await user.save({ session });

    await session.commitTransaction();
    await clearCache("stylist:*");

    // Emit notification for admin verification
    const notificationPayload = {
      type: "stylist_verification_request",
      message: `New stylist "${stylist[0].company}" requires verification`,
      data: {
        stylistId: stylist[0]._id,
        companyName: stylist[0].company,
        cacCertificateNumber: stylist[0].cacCertificateNumber,
        createdAt: new Date(),
      },
    };
    emitNotification(req.io, "newNotification", notificationPayload, "admin_room");

    res.status(StatusCodes.CREATED).json({
      success: true,
      stylist: stylist[0],
      message: "Stylist registered successfully. Awaiting admin verification.",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
const verifyStylistCompany = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { action, rejectionReason } = req.body;
    const { userId } = req.user;

    if (!["verify", "reject"].includes(action)) {
      throw new CustomError.BadRequestError("Invalid action. Use 'verify' or 'reject'");
    }

    const stylist = await Stylist.findById(id).session(session);
    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${id}`);
    }

    // Check if already verified/rejected
    if (stylist.verificationStatus !== "pending") {
      throw new CustomError.BadRequestError(`Stylist is already ${stylist.verificationStatus}`);
    }

    if (action === "verify") {
      stylist.isCompanyVerified = true;
      stylist.verificationStatus = "verified";
      stylist.verificationDate = new Date();
      stylist.verifiedBy = userId;
      stylist.rejectionReason = undefined;

      // Notify stylist
      const notificationPayload = {
        type: "stylist_verified",
        message: `Your company "${stylist.company}" has been verified! You can now add products.`,
        data: {
          stylistId: stylist._id,
          companyName: stylist.company,
          verifiedAt: new Date(),
        },
      };
      emitNotification(req.io, "newNotification", notificationPayload, stylist.owner.toString());
    } else {
      // Reject action
      if (!rejectionReason || rejectionReason.trim().length < 10) {
        throw new CustomError.BadRequestError(
          "Please provide a valid rejection reason (min 10 chars)"
        );
      }

      stylist.isCompanyVerified = false;
      stylist.verificationStatus = "rejected";
      stylist.rejectionReason = rejectionReason.trim();
      stylist.verifiedBy = userId;

      // Notify stylist with reason
      const notificationPayload = {
        type: "stylist_rejected",
        message: `Your company verification for "${stylist.company}" was rejected`,
        data: {
          stylistId: stylist._id,
          companyName: stylist.company,
          rejectionReason: rejectionReason,
          rejectedAt: new Date(),
        },
      };
      emitNotification(req.io, "newNotification", notificationPayload, stylist.owner.toString());
    }

    await stylist.save({ session });
    await session.commitTransaction();

    // Clear cache
    await Promise.all([clearCache(`stylist:${id}`), clearCache("stylist:*")]);

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Stylist ${action === "verify" ? "verified" : "rejected"} successfully`,
      stylist,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const getAllStylists = async (req, res, next) => {
  try {
    const { company, specialty, page = 1, limit = 10 } = req.query;
    const cacheKey = `stylist:${company || ""}:${specialty || ""}:${page}:${limit}`;

    // Check cache
    const cachedData = await getFromCache(cacheKey);
    if (cachedData) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        ...cachedData,
      });
    }

    // Build query
    const query = {};
    if (company) {
      query.company = { $regex: company, $options: "i" };
    }
    if (specialty) {
      query.specialty = { $regex: specialty, $options: "i" };
    }
    if (isCompanyVerified) {
      query.isCompanyVerified = "true";
    }
    // Fetch data
    const [stylists, total] = await Promise.all([
      Stylist.find(query)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Stylist.countDocuments(query),
    ]);

    // Cache and respond
    const responseData = {
      count: stylists.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      stylists,
    };
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
const getSingleStylist = async (req, res, next) => {
  try {
    const { id } = req.params;

    const cacheKey = `stylist:${id}`;
    //get from cache first
    const cachedStylist = await getFromCache(cacheKey);
    if (cacheKey) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        stylist: cachedStylist,
      });
    }
    const stylist = await Stylist.findById(id).lean();

    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${id}`);
    }
    //add to cache
    await setInCache(cacheKey, stylist.toOject());
    res.status(StatusCodes.OK).json({
      success: true,
      stylist,
    });
  } catch (error) {
    next(error);
  }
};
const updateStylist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const updateData = req.body;
    const { role, company } = req.user;

    // Admin can update any stylist, stylist can only update their own company
    if (role === "stylist" && company.toString() !== id) {
      throw new CustomError.UnauthorizedError("You can only update your own company");
    }

    const stylist = await Stylist.findById(id).session(session);
    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${id}`);
    }

    // Admin-only fields
    if (role !== "admin") {
      delete updateData.rating;
      delete updateData.reviews;
      delete updateData.owner;
    }

    // Update fields
    const allowedUpdates = [
      "companyName",
      "description",
      "specialty",
      "experience",
      "services",
      "phone",
      "email",
      "website",
      "socialMedia",
      "location",
    ];

    allowedUpdates.forEach((field) => {
      if (updateData[field] !== undefined) {
        stylist[field] = updateData[field];
      }
    });

    // Case-insensitive name conflict check
    if (updateData.companyName) {
      const nameExists = await Stylist.findOne({
        companyName: { $regex: new RegExp(`^${updateData.companyName}$`, "i") },
        _id: { $ne: id },
      }).session(session);

      if (nameExists) {
        throw new CustomError.BadRequestError("Company name already exists");
      }
    }

    await stylist.save({ session });
    await session.commitTransaction();

    // Clear cache
    await Promise.all([clearCache(`stylist:${id}`), clearCache("stylist:*")]);

    res.status(StatusCodes.OK).json({
      success: true,
      stylist,
      message: "Stylist updated successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const updateStylistProfile = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { role, company } = req.user;
    const { description, specialty, services, experience } = req.body;

    // Only allow stylist to update their own profile
    if (role !== "stylist" || company.toString() !== id) {
      throw new CustomError.UnauthorizedError("You can only update your own profile");
    }

    const stylist = await Stylist.findById(id).session(session);
    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${id}`);
    }

    // Update only profile-related fields
    if (description) stylist.description = description;
    if (specialty) stylist.specialty = specialty;
    if (services) stylist.services = services;
    if (experience) stylist.experience = experience;

    await stylist.save({ session });
    await session.commitTransaction();

    // Clear cache
    await Promise.all([clearCache(`stylist:${id}`), clearCache("stylist:*")]);

    res.status(StatusCodes.OK).json({
      success: true,
      stylist,
      message: "Profile updated successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
const deleteStylist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    // Check if Stylist has products
    const productsCount = await Product.countDocuments({ stylist: id }).session(session);
    if (productsCount > 0) {
      throw new CustomError.BadRequestError("Cannot delete stylist with associated products");
    }

    // Check if any User still references this Stylist
    const usersCount = await User.countDocuments({ company: id }).session(session);
    if (usersCount > 0) {
      throw new CustomError.BadRequestError("Cannot delete stylist with associated users");
    }

    const stylist = await Stylist.findByIdAndDelete(id).session(session);
    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${id}`);
    }

    await session.commitTransaction();
    // clear both the specific stylist cache and the stylist cache
    await Promise.all([clearCache(`stylist${id}`), clearCache(`stylist:*`)]);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Stylist deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
/// images
const uploadStylistAvatar = async (req, res, next) => {
  let tempFilePath = null;

  try {
    const { id } = req.params;
    const { role, company } = req.user;

    if (role === "stylist" && company.toString() !== id) {
      throw new CustomError.UnauthorizedError("You can only update your own avatar");
    }

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

    // Update stylist with new avatar URL
    const stylist = await Stylist.findByIdAndUpdate(id, { avatar: imageUrl }, { new: true });

    await clearCache(`stylist:${id}`);

    res.status(StatusCodes.OK).json({
      success: true,
      avatar: stylist.avatar,
      documentId: doc._id,
      message: "Avatar updated successfully",
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

const uploadStylistBanner = async (req, res, next) => {
  let tempFilePath = null;

  try {
    const { id } = req.params;
    const { role, company } = req.user;

    if (role === "stylist" && company.toString() !== id) {
      throw new CustomError.UnauthorizedError("You can only update your own banner");
    }

    if (!req.files?.banner) {
      throw new CustomError.BadRequestError("Banner image is required");
    }

    const bannerFile = req.files.banner;
    tempFilePath = bannerFile.tempFilePath;
    const fileBuffer = await fs.readFile(tempFilePath);

    // Upload to Sanity
    const uploadResult = await writeClient.assets.upload("image", fileBuffer, {
      filename: bannerFile.name,
      contentType: bannerFile.mimetype,
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

    const imageUrl = `${uploadResult.url}?w=1200&h=400&fit=crop`; // Wide crop for banner

    // Update stylist with new banner URL
    const stylist = await Stylist.findByIdAndUpdate(id, { banner: imageUrl }, { new: true });

    await clearCache(`stylist:${id}`);

    res.status(StatusCodes.OK).json({
      success: true,
      banner: stylist.banner,
      documentId: doc._id,
      message: "Banner updated successfully",
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

const addPortfolioImage = async (req, res, next) => {
  let tempFilePath = null;

  try {
    const { id } = req.params;
    const { role, company } = req.user;
    const { category } = req.body;

    if (role === "stylist" && company.toString() !== id) {
      throw new CustomError.UnauthorizedError("You can only update your own portfolio");
    }

    if (!req.files?.image) {
      throw new CustomError.BadRequestError("Portfolio image is required");
    }

    if (!category) {
      throw new CustomError.BadRequestError("Category is required");
    }

    const imageFile = req.files.image;
    tempFilePath = imageFile.tempFilePath;
    const fileBuffer = await fs.readFile(tempFilePath);

    // Upload to Sanity
    const uploadResult = await writeClient.assets.upload("image", fileBuffer, {
      filename: imageFile.name,
      contentType: imageFile.mimetype,
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

    const imageUrl = `${uploadResult.url}?w=800&h=800&fit=max`; // High quality for portfolio

    // Add to stylist's portfolio
    const stylist = await Stylist.findByIdAndUpdate(
      id,
      {
        $push: {
          portfolio: {
            image: imageUrl,
            category,
            sanityRef: doc._id, // Store Sanity document reference
          },
        },
      },
      { new: true }
    );

    await clearCache(`stylist:${id}`);

    res.status(StatusCodes.OK).json({
      success: true,
      portfolio: stylist.portfolio,
      documentId: doc._id,
      message: "Portfolio image added successfully",
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

const removePortfolioImage = async (req, res, next) => {
  try {
    const { id, imageId } = req.params;
    const { role, company } = req.user;

    if (role === "stylist" && company.toString() !== id) {
      throw new CustomError.UnauthorizedError("You can only update your own portfolio");
    }

    // First get the image to be removed
    const stylist = await Stylist.findById(id);
    const portfolioItem = stylist.portfolio.id(imageId);

    if (!portfolioItem) {
      throw new CustomError.NotFoundError("Portfolio image not found");
    }

    // Delete from Sanity (optional - you might want to keep assets)
    await writeClient.delete(portfolioItem.sanityRef);

    // Remove from portfolio array
    await Stylist.findByIdAndUpdate(id, { $pull: { portfolio: { _id: imageId } } }, { new: true });

    await clearCache(`stylist:${id}`);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Portfolio image removed successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addStylist,
  getAllStylists,
  getSingleStylist,
  updateStylist,
  updateStylistProfile,
  deleteStylist,
  removePortfolioImage,
  addPortfolioImage,
  uploadStylistAvatar,
  uploadStylistBanner,
};

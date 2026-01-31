const Stylist = require("../models/stylistModel");
const User = require("../models/userModel");
const { StatusCodes } = require("http-status-codes");
const { getFromCache, setInCache, clearCache } = require("../utils/redisClient");
const fs = require("fs").promises;
const Product = require("../models/productModel");
const CustomError = require("../errors");
const mongoose = require("mongoose");
const { writeClient } = require("../utils");
const { emitNotification } = require("../utils/socket");

// Valid specialty values
const VALID_SPECIALTIES = ["Traditional", "Corporate", "Casual Wear", "Bridal", "Formal Wear"];

// Helper function to validate specialty array
const validateSpecialties = (specialties) => {
  if (!Array.isArray(specialties) || specialties.length === 0) {
    throw new CustomError.BadRequestError(
      "Provide at least one specialty from: Traditional, Corporate, Casual Wear, Bridal, Formal Wear",
    );
  }

  // Remove duplicates and validate
  const uniqueSpecialties = [...new Set(specialties)];

  const invalidSpecialties = uniqueSpecialties.filter((spec) => !VALID_SPECIALTIES.includes(spec));

  if (invalidSpecialties.length > 0) {
    throw new CustomError.BadRequestError(
      `Invalid specialties: ${invalidSpecialties.join(
        ", ",
      )}. Must be from: ${VALID_SPECIALTIES.join(", ")}`,
    );
  }

  // Limit to 3 specialties
  if (uniqueSpecialties.length > 3) {
    throw new CustomError.BadRequestError("A stylist can have maximum 3 specialties");
  }

  return uniqueSpecialties;
};

const addStylist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      companyName,
      description,
      owner,
      specialty,
      services,
      phone,
      location,
      cacCertificateNumber,
    } = req.body;

    // Validate required fields
    if (
      !companyName ||
      !owner ||
      !phone ||
      !location?.state ||
      !location?.address ||
      !cacCertificateNumber
    ) {
      throw new CustomError.BadRequestError(
        "Provide company name, owner ID, phone, CAC certificate number, and full location (state + address)",
      );
    }

    // Validate specialties (now an array)
    const validatedSpecialties = validateSpecialties(specialty || []);

    // Validate services
    if (!Array.isArray(services) || services.length === 0) {
      throw new CustomError.BadRequestError("Provide at least one service");
    }

    // Check if stylist exists (case-insensitive)
    const existingStylist = await Stylist.findOne({
      companyName: { $regex: new RegExp(`^${companyName}$`, "i") },
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
          companyName,
          description,
          owner,
          specialty: validatedSpecialties, // Now an array
          services,
          phone,
          location,
          cacCertificateNumber: cacCertificateNumber.trim(),
          verificationStatus: "pending",
          isCompanyVerified: false,
        },
      ],
      { session },
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
      message: `New stylist "${stylist[0].companyName}" requires verification`,
      data: {
        stylistId: stylist[0]._id,
        companyName: stylist[0].companyName,
        cacCertificateNumber: stylist[0].cacCertificateNumber,
        createdAt: new Date(),
      },
      recipientModel: "User",
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
        type: "stylist_approved",
        message: `Your company "${stylist.companyName}" has been verified! You can now add products.`,
        data: {
          stylistId: stylist._id,
          companyName: stylist.companyName,
          verifiedAt: new Date(),
        },
        recipientModel: "User",
      };
      emitNotification(req.io, "newNotification", notificationPayload, stylist.owner.toString());
    } else {
      // Reject action
      if (!rejectionReason || rejectionReason.trim().length < 10) {
        throw new CustomError.BadRequestError(
          "Please provide a valid rejection reason (min 10 chars)",
        );
      }

      stylist.isCompanyVerified = false;
      stylist.verificationStatus = "rejected";
      stylist.rejectionReason = rejectionReason.trim();
      stylist.verifiedBy = userId;

      // Notify stylist with reason
      const notificationPayload = {
        type: "stylist_rejected",
        message: `Your company verification for "${stylist.companyName}" was rejected`,
        data: {
          stylistId: stylist._id,
          companyName: stylist.companyName,
          rejectionReason: rejectionReason,
          rejectedAt: new Date(),
        },
        recipientModel: "User",
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
    const { company, specialty, page = 1, limit = 10, isCompanyVerified } = req.query;
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
      query.companyName = { $regex: company, $options: "i" };
    }
    if (specialty && specialty !== "all") {
      // Changed from regex to $in for array matching
      query.specialty = { $in: [specialty] };
    }
    if (isCompanyVerified) {
      query.isCompanyVerified = isCompanyVerified === "true";
    }

    // Fetch data
    const [stylists, total] = await Promise.all([
      Stylist.find(query)
        .populate({
          path: "owner",
          select: "firstName surname email phone",
          transform: (doc) => {
            if (doc) {
              doc.name =
                doc.firstName && doc.surname
                  ? `${doc.firstName} ${doc.surname}`
                  : doc.firstName || doc.surname || "Unknown";
            }
            return doc;
          },
        })
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

const getMyStylistProfile = async (req, res, next) => {
  try {
    const { company, id: userId } = req.user;

    if (!company) {
      throw new CustomError.UnauthorizedError("You are not associated with any stylist company");
    }

    const cacheKey = `stylist:${company}`;

    // Check cache
    const cachedStylist = await getFromCache(cacheKey);
    if (cachedStylist) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        stylist: cachedStylist,
      });
    }

    const stylist = await Stylist.findById(company)
      .populate("owner", "name email avatar")
      .populate("verifiedBy", "name")
      .lean();

    if (!stylist) {
      throw new CustomError.NotFoundError("Stylist profile not found");
    }

    // Ensure documents object exists
    if (!stylist.documents) {
      stylist.documents = {
        cacCertificate: "",
        businessRegistration: "",
        taxCertificate: "",
      };
    }

    // Add to cache
    await setInCache(cacheKey, stylist, 3600);

    res.status(StatusCodes.OK).json({
      success: true,
      fromCache: false,
      stylist,
    });
  } catch (error) {
    next(error);
  }
};

const getSingleStylist = async (req, res, next) => {
  try {
    const { id } = req.params;
    const cacheKey = `stylist:${id}`;

    // Get from cache first
    const cachedStylist = await getFromCache(cacheKey);
    if (cachedStylist) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        stylist: cachedStylist,
      });
    }

    const stylist = await Stylist.findById(id).populate("owner", "firstName surname email phone");
    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${id}`);
    }

    // Add to cache
    await setInCache(cacheKey, stylist);

    res.status(StatusCodes.OK).json({
      success: true,
      fromCache: false,
      stylist,
    });
  } catch (error) {
    next(error);
  }
};

const suspendStylist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { action, suspensionReason } = req.body;
    const { userId } = req.user;

    if (!["suspend", "activate"].includes(action)) {
      throw new CustomError.BadRequestError("Invalid action. Use 'suspend' or 'activate'");
    }

    const stylist = await Stylist.findById(id).session(session);
    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${id}`);
    }

    if (action === "suspend") {
      // Validate suspension reason
      if (!suspensionReason || suspensionReason.trim().length < 10) {
        throw new CustomError.BadRequestError(
          "Please provide a valid suspension reason (min 10 chars)",
        );
      }

      // Check if already suspended
      if (stylist.status === "suspended") {
        throw new CustomError.BadRequestError("Stylist is already suspended");
      }

      stylist.status = "suspended";
      stylist.suspensionReason = suspensionReason.trim();
      stylist.suspendedBy = userId;
      stylist.suspensionDate = new Date();
      stylist.canAddProducts = false;

      // Notify stylist
      const notificationPayload = {
        type: "stylist_suspended",
        message: `Your company "${stylist.companyName}" has been suspended`,
        data: {
          stylistId: stylist._id,
          companyName: stylist.companyName,
          suspensionReason: suspensionReason.trim(),
          suspendedAt: new Date(),
        },
        recipientModel: "User",
      };
      emitNotification(req.io, "newNotification", notificationPayload, stylist.owner.toString());
    } else {
      // Activate action
      if (stylist.status !== "suspended") {
        throw new CustomError.BadRequestError("Stylist is not suspended");
      }

      stylist.status = "active";
      stylist.suspensionReason = undefined;
      stylist.suspendedBy = undefined;
      stylist.suspensionDate = undefined;

      // Only allow adding products if verified
      stylist.canAddProducts =
        stylist.isCompanyVerified && stylist.verificationStatus === "verified";

      // Notify stylist
      const notificationPayload = {
        type: "stylist_activated",
        message: `Your company "${stylist.companyName}" has been reactivated`,
        data: {
          stylistId: stylist._id,
          companyName: stylist.companyName,
          activatedAt: new Date(),
        },
        recipientModel: "User",
      };
      emitNotification(req.io, "newNotification", notificationPayload, stylist.owner.toString());
    }

    await stylist.save({ session });
    await session.commitTransaction();

    // Clear cache
    await Promise.all([clearCache(`stylist:${id}`), clearCache("stylist:*")]);

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Stylist ${action === "suspend" ? "suspended" : "activated"} successfully`,
      stylist,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
    console.log(error);
  } finally {
    session.endSession();
  }
};

// ADMIN UPDATE: Full update for any stylist
const updateStylist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const updateData = req.body;
    const { role } = req.user;

    if (role !== "admin") {
      throw new CustomError.UnauthorizedError(
        "Only admins can update stylists using this endpoint",
      );
    }

    const stylist = await Stylist.findById(id).session(session);
    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${id}`);
    }

    // Define all updatable fields (admin can update everything)
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
      "rating",
      "reviews",
      "owner",
      "status",
      "suspensionReason",
      "verificationStatus",
    ];

    // Don't allow updating verificationStatus through this endpoint
    if (updateData.verificationStatus !== undefined) {
      throw new CustomError.BadRequestError(
        "Use /verify/:id endpoint to update verification status",
      );
    }

    // Update fields
    for (const field of allowedUpdates) {
      if (updateData[field] !== undefined && field !== "verificationStatus") {
        if (field === "socialMedia" || field === "location") {
          // Merge objects for socialMedia and location
          stylist[field] = {
            ...stylist[field],
            ...updateData[field],
          };
        } else if (field === "services" && Array.isArray(updateData.services)) {
          // Validate services array
          stylist.services = updateData.services.filter(
            (service) => typeof service === "string" && service.trim().length > 0,
          );
        } else if (field === "specialty" && Array.isArray(updateData.specialty)) {
          // Validate specialties array
          stylist.specialty = validateSpecialties(updateData.specialty);
        } else {
          stylist[field] = updateData[field];
        }
      }
    }

    // Update canAddProducts based on status and verification
    if (updateData.status === "suspended" || stylist.status === "suspended") {
      stylist.canAddProducts = false;
    } else if (updateData.status === "active" || stylist.status === "active") {
      stylist.canAddProducts =
        stylist.isCompanyVerified && stylist.verificationStatus === "verified";
    }

    // Case-insensitive company name conflict check
    if (updateData.companyName && updateData.companyName !== stylist.companyName) {
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

// STYLIST PROFILE UPDATE: Stylist updates their own profile only
const updateStylistProfile = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const updateData = req.body;
    const { role, company, id: userId } = req.user;

    // Verify it's a stylist
    if (role !== "stylist") {
      throw new CustomError.UnauthorizedError("Only stylists can update their profile");
    }
    const stylist = await Stylist.findOne({ owner: userId }).session(session);

    if (!stylist) {
      throw new CustomError.NotFoundError(`No stylist found with id: ${userId}`);
    }
    // Check ownership
    if (company.toString() !== stylist._id.toString()) {
      throw new CustomError.UnauthorizedError("You can only update your own profile");
    }

    // Define allowed fields for stylist self-update
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
      "cacCertificateNumber",
    ];

    // Remove admin-only fields if somehow included
    delete updateData.rating;
    delete updateData.reviews;
    delete updateData.owner;
    delete updateData.isVerified;
    delete updateData.verificationStatus;
    delete updateData.documents; // Handle separately

    // Handle documents update if provided
    if (updateData.documents && typeof updateData.documents === "object") {
      const allowedDocuments = ["cacCertificate", "businessRegistration", "taxCertificate"];
      allowedDocuments.forEach((docType) => {
        if (updateData.documents[docType] !== undefined) {
          stylist.documents[docType] = updateData.documents[docType];
        }
      });
    }

    // Update allowed fields
    for (const field of allowedUpdates) {
      if (updateData[field] !== undefined) {
        if (field === "socialMedia" || field === "location") {
          // Merge objects
          stylist[field] = {
            ...stylist[field],
            ...updateData[field],
          };
        } else if (field === "services" && Array.isArray(updateData.services)) {
          // Validate services array
          stylist.services = updateData.services.filter(
            (service) => typeof service === "string" && service.trim().length > 0,
          );
        } else if (field === "specialty" && Array.isArray(updateData.specialty)) {
          // Validate specialties array (stricter limit for self-update)
          stylist.specialty = validateSpecialties(updateData.specialty);
        } else if (field === "cacCertificateNumber") {
          if (updateData[field] && updateData[field] !== stylist.cacCertificateNumber) {
            stylist.cacCertificateNumber = updateData[field].trim();
          }
        } else {
          stylist[field] = updateData[field];
        }
      }
    }

    // Case-insensitive company name conflict check
    if (updateData.companyName && updateData.companyName !== stylist.companyName) {
      const nameExists = await Stylist.findOne({
        companyName: { $regex: new RegExp(`^${updateData.companyName}$`, "i") },
        _id: { $ne: userId },
      }).session(session);

      if (nameExists) {
        throw new CustomError.BadRequestError("Company name already exists");
      }
    }

    // CAC number uniqueness check
    if (
      updateData.cacCertificateNumber &&
      updateData.cacCertificateNumber !== stylist.cacCertificateNumber
    ) {
      const cacExists = await Stylist.findOne({
        cacCertificateNumber: updateData.cacCertificateNumber.trim(),
        _id: { $ne: userId },
      }).session(session);

      if (cacExists) {
        throw new CustomError.BadRequestError("CAC certificate number already registered");
      }
    }

    await stylist.save({ session });
    await session.commitTransaction();

    // Clear cache
    await Promise.all([
      clearCache(`stylist:${userId}`),
      clearCache("stylist:*"),
      clearCache(`user:${userId}`),
    ]);

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

// Get products by stylist ID (public endpoint)
const getProductsByStylist = async (req, res, next) => {
  try {
    const { id: stylistId } = req.params;
    const { page = 1, limit = 12, status = "approved", category, type } = req.query;
    console.log("Stylist ID:", stylistId);
    console.log("Query Parameters:", req.query);

    if (!mongoose.Types.ObjectId.isValid(stylistId)) {
      throw new CustomError.BadRequestError("Invalid stylist ID");
    }

    // Verify stylist exists and is active/verified
    const stylist = await Stylist.findById(stylistId);
    if (!stylist) {
      throw new CustomError.NotFoundError("Stylist not found");
    }

    // Build query
    const query = {
      stylist: stylistId,
      status: status || "approved",
    };

    // Additional filters
    if (category) query.category = category;
    if (type) query.type = type;

    // Cache key
    const cacheKey = `products:stylist:${stylistId}:${page}:${limit}:${status}:${category || ""}:${
      type || ""
    }`;

    // Try cache first
    const cachedData = await getFromCache(cacheKey);
    if (cachedData) {
      return res.status(StatusCodes.OK).json({
        success: true,
        fromCache: true,
        ...cachedData,
      });
    }

    // Pagination
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      Product.find(query)
        .select("name price mainImage rating category type stock status featured")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);

    // Add stylist info to each product
    const productsWithStylistInfo = products.map((product) => ({
      ...product,
      stylistInfo: {
        companyName: stylist.companyName,
        isVerified: stylist.isCompanyVerified,
        avatar: stylist.avatar,
      },
    }));

    const responseData = {
      count: products.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      products: productsWithStylistInfo,
      stylistInfo: {
        companyName: stylist.companyName,
        totalProducts: total,
        isVerified: stylist.isCompanyVerified,
      },
    };

    // Cache for 30 minutes
    await setInCache(cacheKey, responseData, 1800);

    res.status(StatusCodes.OK).json({
      success: true,
      fromCache: false,
      ...responseData,
    });
  } catch (error) {
    next(error);
  }
};
const deleteStylist = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    console.log(id);

    // Check if Stylist has products
    const Product = require("../models/productModel"); // Add this import at top
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
    // Clear both the specific stylist cache and the stylist cache
    await Promise.all([clearCache(`stylist:${id}`), clearCache("stylist:*")]);

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

// Images and documents controllers (unchanged, they don't touch specialty)
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

    const imageUrl = `${uploadResult.url}?w=800&h=800&fit=max`;

    // Create portfolio item with proper structure
    const portfolioItem = {
      image: imageUrl,
      category,
      sanityRef: doc._id,
    };

    // Add to stylist's portfolio and get updated document
    const stylist = await Stylist.findByIdAndUpdate(
      id,
      { $push: { portfolio: portfolioItem } },
      { new: true, runValidators: true },
    );

    // Get the newly added portfolio item with its _id
    const addedItem = stylist.portfolio[stylist.portfolio.length - 1];

    await clearCache(`stylist:${id}`);

    res.status(StatusCodes.OK).json({
      success: true,
      portfolioItem: addedItem,
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

const uploadStylistDocument = async (req, res, next) => {
  let tempFilePath = null;

  try {
    const { id } = req.params;
    const { role, company } = req.user;
    const { documentType } = req.body;

    if (role === "stylist" && company.toString() !== id) {
      throw new CustomError.UnauthorizedError("You can only update your own documents");
    }

    if (!req.files?.document) {
      throw new CustomError.BadRequestError("Document file is required");
    }

    if (
      !documentType ||
      !["cacCertificate", "businessRegistration", "taxCertificate"].includes(documentType)
    ) {
      throw new CustomError.BadRequestError(
        "Valid document type is required (cacCertificate, businessRegistration, or taxCertificate)",
      );
    }

    const documentFile = req.files.document;
    tempFilePath = documentFile.tempFilePath;
    const fileBuffer = await fs.readFile(tempFilePath);

    // Validate file type (PDF or images)
    const validMimeTypes = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
    if (!validMimeTypes.includes(documentFile.mimetype)) {
      throw new CustomError.BadRequestError("Only PDF, JPEG, JPG, and PNG files are allowed");
    }

    // Upload to Sanity
    const uploadResult = await writeClient.assets.upload("file", fileBuffer, {
      filename: documentFile.name,
      contentType: documentFile.mimetype,
    });

    // Create reference document
    const doc = await writeClient.create({
      _type: "documentStorage",
      document: {
        _type: "file",
        asset: {
          _type: "reference",
          _ref: uploadResult._id,
        },
        title: `${documentType}_${id}`,
      },
    });

    const documentUrl = uploadResult.url;

    // Update stylist's documents object
    const updateField = `documents.${documentType}`;
    const stylist = await Stylist.findByIdAndUpdate(
      id,
      { [updateField]: documentUrl },
      { new: true },
    );

    // Clear cache
    await Promise.all([clearCache(`stylist:${id}`), clearCache("stylist:*")]);

    res.status(StatusCodes.OK).json({
      success: true,
      documentUrl,
      documentType,
      message: `${documentType.replace(/([A-Z])/g, " $1")} uploaded successfully`,
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
  verifyStylistCompany,
  getAllStylists,
  getSingleStylist,
  getMyStylistProfile,
  updateStylist,
  updateStylistProfile,
  deleteStylist,
  removePortfolioImage,
  addPortfolioImage,
  uploadStylistAvatar,
  uploadStylistBanner,
  uploadStylistDocument,
  suspendStylist,
  getProductsByStylist,
};

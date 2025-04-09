const Product = require("../models/productModel");
const CustomError = require("../errors");
const { StatusCodes } = require("http-status-codes");
const generateSKU = require("../utils/skuGenerator");
const { writeClient } = require("../utils");
const fs = require("fs").promises;
const path = require("path");
const addProduct = async (req, res, next) => {
  try {
    const {
      name,
      price,
      mainImage,
      subImages,
      stylist,
      category,
      description,
      stock,
      rating,
      featured,
      attributes,
    } = req.body;

    // Generate a unique SKU
    const sku = generateSKU(category, name);

    // Check if SKU already exists
    const existingProduct = await Product.findOne({ sku });
    if (existingProduct) {
      throw new CustomError.BadRequestError("Product with this SKU already exists");
    }

    const product = await Product.create({
      name,
      price,
      mainImage,
      subImages,
      stylist,
      sku,
      category,
      description,
      stock,
      rating,
      featured,
      attributes,
    });

    res.status(StatusCodes.CREATED).json({
      success: true,
      product,
      message: "Product added successfully",
    });
  } catch (error) {
    next(error);
  }
};
const getAllProducts = async (req, res, next) => {
  try {
    const { stylist, page = 1, name, limit = 10, category } = req.query;

    // Base query
    const query = {};

    // Apply filters if provided
    if (stylist) query.stylist = stylist;
    if (name) query.name = { $regex: name, $options: "i" };
    if (category) query.category = category;

    // Pagination
    const skip = (page - 1) * limit;

    const products = await Product.find(query)
      .select("name price mainImage rating category")
      .populate("stylist", "name")
      .skip(skip)
      .limit(limit)
      .lean(); // Convert to plain JS objects (better performance)

    if (!products || products.length === 0) {
      throw new CustomError.NotFoundError("No products found");
    }

    // Get total count for pagination metadata
    const totalProducts = await Product.countDocuments(query);

    res.status(StatusCodes.OK).json({
      success: true,
      count: products.length,
      total: totalProducts,
      page: Number(page),
      pages: Math.ceil(totalProducts / limit),
      products,
    });
  } catch (error) {
    next(error);
  }
};
const getDetailProduct = async (req, res, next) => {
  try {
    const { productId: id } = req.params;

    const product = await Product.findById(id)
      .populate("stylist", "name")
      .populate("category", "name")
      .populate("reviews.user", "name");
    if (!product) {
      throw new CustomError.NotFoundError(`Product with ID ${id} not found`);
    }

    res.status(StatusCodes.OK).json({ success: true, product });
  } catch (error) {
    next(error);
  }
};
const updateProduct = async (req, res, next) => {
  try {
    const { productId: id } = req.params;
    const { name, price, image, brand, sku, description, category, stock, rating, featured } =
      req.body;

    const product = await Product.findById(id);
    if (!product) {
      throw new CustomError.NotFoundError(`Product with ID ${id} not found`);
    }

    product.name = name || product.name;
    product.price = price || product.price;
    product.image = image || product.image;
    product.brand = brand || product.brand;
    product.sku = sku || product.sku;
    product.description = description || product.description;
    product.category = category || product.category;
    product.stock = stock || product.stock;
    product.rating = rating || product.rating;
    product.featured = featured || product.featured;

    await product.save();

    res.status(StatusCodes.OK).json({ success: true, product, message: "product updated" });
  } catch (error) {
    next(error);
  }
};
const deleteProduct = async (req, res, next) => {
  try {
    const { productId: id } = req.params;

    const product = await Product.findByIdAndDelete(id);

    if (!product) {
      throw new CustomError.NotFoundError(`Product with ID ${id} not found`);
    }

    res.status(StatusCodes.OK).json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    next(error);
  }
};
const uploadProductImage = async (req, res, next) => {
  let tempFilePath = null;

  try {
    if (!req.files?.image) {
      throw new CustomError.BadRequestError("No image file uploaded");
    }

    const imageFile = req.files.image;
    tempFilePath = imageFile.tempFilePath;
    const fileBuffer = await fs.readFile(tempFilePath);

    // Upload the image asset
    const uploadResult = await writeClient.assets.upload("image", fileBuffer, {
      filename: imageFile.name,
      contentType: imageFile.mimetype,
    });

    // Create an imageStorage document referencing the asset
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

    const imageUrl = `${uploadResult.url}?w=500&h=500&fit=crop`;

    res.status(StatusCodes.OK).json({
      success: true,
      imageUrl,
      documentId: doc._id,
      message: "Image uploaded and documented successfully",
    });
  } catch (error) {
    next(error);
  } finally {
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
      } catch (e) {
        console.error(e);
      }
    }
  }
};
module.exports = {
  addProduct,
  getAllProducts,
  getDetailProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
};

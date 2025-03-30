const Category = require("../models/categoryModel");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const { createSlug } = require("../utils"); // Helper for slug generation

const createCategory = async (req, res) => {
  const { name, description, image } = req.body;

  // Validation
  if (!name || !image) {
    throw new CustomError.BadRequestError("Name and image are required");
  }

  // Check if category already exists
  const existingCategory = await Category.findOne({ name });
  if (existingCategory) {
    throw new CustomError.BadRequestError("Category name already exists");
  }

  // Create category
  const category = await Category.create({
    name,
    description,
    image,
    parentCategory: parentCategory || null,
    featured: featured || false,
    slug: createSlug(name), // Helper function to generate slug
  });

  res.status(StatusCodes.CREATED).json({
    success: true,
    category,
  });
};

// @desc    Get all categories
// @route   GET /api/v1/categories
// @access  Public
const getAllCategories = async (req, res) => {
  const { featured, parent } = req.query;
  const query = {};

  // Filter by featured/parent category
  if (featured) query.featured = featured === "true";
  if (parent) {
    if (parent === "null") {
      query.parentCategory = null; // Top-level categories
    } else {
      query.parentCategory = parent;
    }
  }

  const categories = await Category.find(query)
    .populate({
      path: "parentCategory",
      select: "name slug",
    })
    .sort("name");

  res.status(StatusCodes.OK).json({
    success: true,
    count: categories.length,
    categories,
  });
};

// @desc    Get single category
// @route   GET /api/v1/categories/:id
// @access  Public
const getSingleCategory = async (req, res) => {
  const { id } = req.params;

  const category = await Category.findById(id).populate({
    path: "subcategories",
    select: "name slug image",
  });

  if (!category) {
    throw new CustomError.NotFoundError(`No category found with id: ${id}`);
  }

  res.status(StatusCodes.OK).json({
    success: true,
    category,
  });
};

// @desc    Update category
// @route   PATCH /api/v1/categories/:id
// @access  Private/Admin
const updateCategory = async (req, res) => {
  const { id } = req.params;
  const { name, description, image, featured } = req.body;

  const category = await Category.findById(id);
  if (!category) {
    throw new CustomError.NotFoundError(`No category found with id: ${id}`);
  }

  // Check if new name conflicts
  if (name && name !== category.name) {
    const nameExists = await Category.findOne({ name });
    if (nameExists) {
      throw new CustomError.BadRequestError("Category name already exists");
    }
    category.slug = createSlug(name); // Update slug if name changes
  }

  // Update fields
  category.name = name || category.name;
  category.description = description || category.description;
  category.image = image || category.image;
  category.featured = featured !== undefined ? featured : category.featured;

  await category.save();

  res.status(StatusCodes.OK).json({
    success: true,
    category,
  });
};

// @desc    Delete category
// @route   DELETE /api/v1/categories/:id
// @access  Private/Admin
const deleteCategory = async (req, res) => {
  const { id } = req.params;

  // Check if category has products
  const productsCount = await Product.countDocuments({ category: id });
  if (productsCount > 0) {
    throw new CustomError.BadRequestError("Cannot delete category with associated products");
  }

  // Check if category has subcategories
  const subcategoriesCount = await Category.countDocuments({ parentCategory: id });
  if (subcategoriesCount > 0) {
    throw new CustomError.BadRequestError("Cannot delete category with subcategories");
  }

  const category = await Category.findByIdAndDelete(id);
  if (!category) {
    throw new CustomError.NotFoundError(`No category found with id: ${id}`);
  }

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Category deleted successfully",
  });
};

module.exports = {
  createCategory,
  getAllCategories,
  getSingleCategory,
  updateCategory,
  deleteCategory,
};

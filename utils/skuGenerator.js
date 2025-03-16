const generateSKU = (brand, category, name) => {
  const brandCode = brand.slice(0, 3).toUpperCase();
  const categoryCode = category.slice(0, 3).toUpperCase();
  const nameCode = name.slice(0, 3).toUpperCase();

  const randomNumber = Math.floor(1000 + Math.random() * 9000);

  const sku = `${brandCode}-${categoryCode}-${nameCode}-${randomNumber}`;
  return sku;
};

module.exports = generateSKU;

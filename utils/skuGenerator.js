const generateSKU = (category, name) => {
  const categoryCode = category
    .split(" ")
    .map((word) => word.slice(0, 3))
    .slice(0, 2)
    .join("-")
    .toUpperCase();
  const nameCode = name.slice(0, 3).toUpperCase();

  const randomNumber = Math.floor(1000 + Math.random() * 9000);

  const sku = `${categoryCode}-${nameCode}-${randomNumber}`;
  console.log(sku);
  return sku;
};

module.exports = generateSKU;

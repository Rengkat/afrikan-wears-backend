const getTokenExpity = () => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt;
};
module.exports = getTokenExpity;

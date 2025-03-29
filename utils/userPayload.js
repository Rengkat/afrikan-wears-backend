const createUserPayload = (user) => {
  return {
    name: user.name,
    role: user.role,
    id: user._id,
  };
};
module.exports = createUserPayload;

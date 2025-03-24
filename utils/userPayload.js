const createUserPayload = (user) => {
  return {
    name: user.name,
    role: user.role,
  };
};
module.exports = createUserPayload;

const createUserPayload = (user) => {
  return {
    name: user.username,
    role: user.role,
  };
};
module.exports = createUserPayload;

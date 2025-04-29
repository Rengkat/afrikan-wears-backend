const createUserPayload = (user) => {
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    id: user._id,
    company: user.company,
  };
};
module.exports = createUserPayload;

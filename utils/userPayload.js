const createUserPayload = (user) => {
  return {
    firstName: user.firstName,
    surname: user.surname,
    email: user.email,
    role: user.role,
    id: user._id,
    company: user.company,
  };
};
module.exports = createUserPayload;

const jwt = require("jsonwebtoken");
const createJwt = ({ payload }) => {
  const token = jwt.sign(payload, process.env.JWT_SECRET);
  return token;
};
const attachTokenToResponse = ({ res, userPayload, refreshToken }) => {
  const accessTokenJWT = createJwt({ payload: { accessToken: userPayload } });
  const refreshTokenJWT = createJwt({ payload: { accessToken: userPayload, refreshToken } });
  //attach to cookies
};

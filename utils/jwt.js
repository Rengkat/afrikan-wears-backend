const jwt = require("jsonwebtoken");
const createJwt = ({ payload }) => {
  const token = jwt.sign(payload, process.env.JWT_SECRET);
  return token;
};
const isTokenVerified = (token) => jwt.verify(token, process.env.JWT_SECRET);
const attachTokenToResponse = ({ res, userPayload, refreshToken }) => {
  const accessTokenJWT = createJwt({ payload: { accessToken: userPayload } });
  const refreshTokenJWT = createJwt({ payload: { accessToken: userPayload, refreshToken } });
  //attach to cookies
  res.cookie("accessToken", accessTokenJWT, {
    httpOnly: true,
    maxAge: 1000 * 60 * 5,
    signed: true,
    secure: false,
  });
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    expires: new Date(Date.now()) + 100 * 60 * 60 * 24 * 30,
    signed: true,
    secure: false,
  });
};
module.exports = { attachTokenToResponse, isTokenVerified };

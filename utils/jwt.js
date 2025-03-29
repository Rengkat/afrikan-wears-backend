const jwt = require("jsonwebtoken");
const createJwt = ({ payload }) => {
  const token = jwt.sign(payload, process.env.JWT_SECRET);
  return token;
};
const isTokenVerified = (token) => jwt.verify(token, process.env.JWT_SECRET);
const attachTokenToResponse = ({ res, userPayload, refreshToken }) => {
  const accessTokenJWT = createJwt({ payload: { accessToken: userPayload } });
  const refreshTokenJWT = createJwt({ payload: { accessToken: userPayload, refreshToken } });

  // Attach accessToken (short-lived, e.g., 5 minutes)
  res.cookie("accessToken", accessTokenJWT, {
    httpOnly: true,
    maxAge: 1000 * 60 * 5,
    signed: true,
    secure: process.env.NODE_ENV === "production",
  });

  // Attach refreshToken (long-lived, e.g., 100 days)
  res.cookie("refreshToken", refreshTokenJWT, {
    httpOnly: true,
    expires: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000),
    signed: true,
    secure: process.env.NODE_ENV === "production",
  });
};
module.exports = { attachTokenToResponse, isTokenVerified };

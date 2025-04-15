const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/userModel");
const Token = require("../models/tokenModel");
const { attachTokenToResponse, createUserPayload } = require("../utils");
const CustomError = require("../errors");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const { id, displayName, emails, photos } = profile;
        const email = emails[0].value;
        const image = photos[0]?.value;

        // Check if user exists
        let user = await User.findOne({ email });

        if (!user) {
          // Create new user if doesn't exist
          user = await User.create({
            name: displayName,
            email,
            googleId: id,
            isVerified: true,
            image,
            password: crypto.randomBytes(16).toString("hex"), // Random password since using Google Auth
          });
        } else if (!user.googleId) {
          // Update existing user with Google ID if not already set
          user.googleId = id;
          if (!user.image && image) user.image = image;
          await user.save();
        }

        // Create or update refresh token
        const existingToken = await Token.findOne({ user: user._id });
        let refreshTokenValue;

        if (existingToken) {
          refreshTokenValue = existingToken.refreshToken;
          if (!existingToken.isValid) {
            existingToken.isValid = true;
            await existingToken.save();
          }
        } else {
          refreshTokenValue = crypto.randomBytes(40).toString("hex");
          await Token.create({
            refreshToken: refreshTokenValue,
            user: user._id,
            ip: req.ip,
            userAgent: req.headers["user-agent"],
          });
        }

        // Create user payload
        const userPayload = createUserPayload(user);
        userPayload.refreshToken = refreshTokenValue;

        done(null, userPayload);
      } catch (error) {
        done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

module.exports = passport;

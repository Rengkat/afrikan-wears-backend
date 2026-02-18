// Load .env
require("dotenv").config();
require("./utils/googleOauth");
const { Server } = require("socket.io");
const { connectRedis } = require("./utils/redisClient");
const http = require("http");

// Express and middleware
const cors = require("cors");
const express = require("express");
const cookieParser = require("cookie-parser");
const expressFileUpload = require("express-fileupload");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const passport = require("passport");
const session = require("express-session");
const User = require("./models/userModel");
const Message = require("./models/messageModel");
const app = express();
const server = http.createServer(app);

// Database connection
const connectDB = require("./db/connectDB");

// Route imports
const authRouter = require("./routes/authRoute");
const productRouter = require("./routes/productRoute");
const userRouter = require("./routes/userRouter");
const addressRouter = require("./routes/addressRoute");
const cartRouter = require("./routes/cartRoute");
const wishlistRouter = require("./routes/wishlistRoute");
const messageRouter = require("./routes/messagesRoute");
const stylistRouter = require("./routes/stylistRoute");
const orderRoute = require("./routes/orderRoute");
const transactionRoute = require("./routes/transactionRoute");
const notificationRoute = require("./routes/notificationRoute");
const webhookRoute = require("./routes/webhooks");
// Middleware imports
const notFoundMiddleware = require("./middleware/not-found");
const errorHandlerMiddleware = require("./middleware/error-handler");

// Socket handlers
const setupSocketHandlers = require("./utils/setupSocketHandlers");
// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // Limit each IP to 50 requests per windowMs for auth routes
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Limit each IP to 100 requests per windowMs for other routes
});

// Middleware setup
app.use(morgan("dev"));
app.use(helmet());
app.use(express.json());
app.use(cookieParser(process.env.JWT_SECRET));
app.use(expressFileUpload({ useTempFiles: true }));
app.use(express.static("public"));

// Home route for documentation
app.get("/", (req, res) => {
  res.send("Welcome to AfriWears API");
});

// CORS setup
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
  "http://localhost:5000",
  "http://localhost:3000",
  "https://afrikan-wears-backend.onrender.com",
];
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked for origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Socket.io initialization
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// Attach socket instance to request object
app.use((req, res, next) => {
  req.io = io;
  next();
});
// Setup socket handlers
// Session configuration
setupSocketHandlers(io);
// Session configuration
// app.use(
//   session({
//     secret: process.env.JWT_SECRET,
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//       secure: process.env.NODE_ENV === "production",
//       httpOnly: true,
//       maxAge: 1000 * 60 * 60 * 24, // 1 day
//     },
//   })
// );

// Initialize passport
// app.use(passport.initialize());
// app.use(passport.session());

// Routes with rate limiting
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/products", apiLimiter, productRouter);
app.use("/api/users", apiLimiter, userRouter);
app.use("/api/addresses", apiLimiter, addressRouter);
app.use("/api/cart", apiLimiter, cartRouter);
app.use("/api/wishlist", apiLimiter, wishlistRouter);
app.use("/api/messages", apiLimiter, messageRouter);
app.use("/api/stylists", apiLimiter, stylistRouter);
app.use("/api/orders", apiLimiter, orderRoute);
app.use("/api/transactions", apiLimiter, transactionRoute);
app.use("/api/notifications", apiLimiter, notificationRoute);
app.use("/api/webhooks", apiLimiter, webhookRoute);
// Error handling middleware
app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

// Validate environment variables
const validateEnvVariables = () => {
  const requiredEnvVars = ["MONGO_URI", "JWT_SECRET"];
  requiredEnvVars.forEach((envVar) => {
    if (!process.env[envVar]) {
      throw new Error(`${envVar} is not defined in .env`);
    }
  });

  if (!process.env.PORT) {
    console.warn("PORT is not defined in .env, using default port 5000");
  }
};

// Start the server
const port = process.env.PORT || 5000;

const start = async () => {
  try {
    validateEnvVariables();
    await connectDB(process.env.MONGO_URI);
    await connectRedis();
    server.listen(port, () => console.log(`Server running on port ${port}...`));
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = () => {
  console.log("Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forcing shutdown...");
    process.exit(1);
  }, 5000);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Start the application
start();

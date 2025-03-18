// Load .env
require("dotenv").config();
const { Server } = require("socket.io");
const http = require("http");

// Express and middleware
const cors = require("cors");
const express = require("express");
const cookieParser = require("cookie-parser");
const expressFileUpload = require("express-fileupload");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const server = http.createServer(app);

// Database connection
const connectDB = require("./db/connectDB");

// Route imports
const authRoute = require("./routes/authRoute");
const productRoute = require("./routes/productRoute");
const userRoute = require("./routes/userRouter");
const cartRouter = require("./routes/cartRoute");

// Middleware imports
const notFoundMiddleware = require("./middleware/not-found");
const errorHandlerMiddleware = require("./middleware/error-handler");

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs for auth routes
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs for other routes
});

// Middleware setup
app.use(morgan("dev"));
app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(expressFileUpload({ useTempFiles: true }));
app.use(express.static("public"));

// Home route for documentation
app.get("/", (req, res) => {
  res.send("Welcome to AfrikanWears API");
});

// CORS setup
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:3000"];
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
  })
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

// Socket.io events
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("joinUser", (userId) => {
    socket.join(userId);
    console.log(`User ${socket.id} joined their channel: ${userId}`);
  });

  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
  });
});

// Routes with rate limiting
app.use("/api/auth", authLimiter, authRoute);
app.use("/api/products", apiLimiter, productRoute);
app.use("/api/users", apiLimiter, userRoute);
app.use("/api/carts", apiLimiter, cartRouter);

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
